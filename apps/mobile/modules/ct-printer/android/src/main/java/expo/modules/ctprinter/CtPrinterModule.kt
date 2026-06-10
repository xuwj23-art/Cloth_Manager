package expo.modules.ctprinter

import android.app.Application
import android.bluetooth.BluetoothAdapter
import android.content.Context
import android.graphics.Point
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.ctaiot.ctprinter.ctpl.CTPL
import com.ctaiot.ctprinter.ctpl.Device
import com.ctaiot.ctprinter.ctpl.RespCallback
import com.ctaiot.ctprinter.ctpl.param.QREncodeMode
import com.ctaiot.ctprinter.ctpl.param.QRLevel
import com.ctaiot.ctprinter.ctpl.param.Rotate
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 驰腾(CTPL)蓝牙标签打印机封装。
 *
 * 设计：
 * - 连接结果是异步的（SDK 通过 RespCallback 回传），connect() 暴露为 Promise，
 *   在回调里 resolve/reject。
 * - 打印为「mm 坐标」由 JS 端计算好后下发，原生按 dpi 把 mm 换算成点(dot)，
 *   逐张 clean→setSize→drawQRCode→drawText…→print→execute。
 * - 设备发现采用「系统已配对(经典蓝牙SPP)设备列表」，符合厂商文档建议（先在系统蓝牙配对）。
 */
class CtPrinterModule : Module() {

  private var initialized = false
  @Volatile private var pendingConnect: Promise? = null
  @Volatile private var connecting = false
  private val mainHandler = Handler(Looper.getMainLooper())
  private var connectTimeout: Runnable? = null

  override fun definition() = ModuleDefinition {
    Name("CtPrinter")

    Events("onConnect", "onData")

    // 注意：不在 OnCreate 里初始化 SDK，避免启动期触发厂商 SDK 导致崩溃/白屏。
    // 初始化延迟到首次 connect() 时进行（ensureInit 内部幂等）。

    // 已配对(经典蓝牙)设备列表 —— 先在系统蓝牙里配对打印机，再在 App 里选择
    Function("getBondedDevices") {
      val adapter = BluetoothAdapter.getDefaultAdapter()
        ?: return@Function emptyList<Map<String, String>>()
      try {
        adapter.bondedDevices?.map {
          mapOf("name" to (it.name ?: "未知设备"), "mac" to it.address)
        } ?: emptyList()
      } catch (e: SecurityException) {
        emptyList<Map<String, String>>()
      }
    }

    Function("isConnected") {
      try {
        CTPL.getInstance().isConnected
      } catch (e: Exception) {
        false
      }
    }

    Function("disconnect") {
      try {
        CTPL.getInstance().disconnect()
      } catch (e: Exception) {
        // 忽略
      }
    }

    // 设备的「位置/GPS」总开关是否打开（SPP 连接要求其为开）
    Function("isLocationEnabled") {
      try {
        val ctx = appContext.reactContext ?: return@Function true
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
          ?: return@Function true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          lm.isLocationEnabled
        } else {
          @Suppress("DEPRECATION")
          (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
            lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
        }
      } catch (e: Exception) {
        true
      }
    }

    // 连接打印机。port: "SPP"(默认) 或 "BLE"。结果通过 Promise 反馈。
    AsyncFunction("connect") { mac: String, port: String, promise: Promise ->
      ensureInit()
      if (!initialized) {
        promise.reject("E_INIT", "打印模块初始化失败（无 Application 上下文）", null)
        return@AsyncFunction
      }
      // 关键：连接不可重入。厂商 SDK 在并发连接时会触发空指针并崩溃，
      // 所以正在连接时直接拒绝新的请求，绝不再次调用 SDK.connect。
      if (connecting) {
        promise.reject("E_BUSY", "正在连接中，请稍候…", null)
        return@AsyncFunction
      }
      connecting = true
      pendingConnect = promise
      try {
        val d = Device()
        if (port == "BLE") {
          d.setPort(CTPL.Port.BLE)
          // 驰腾 BLE 默认服务 UUID（取自官方 Demo）
          d.setBleServiceUUID("49535343-fe7d-4ae5-8fa9-9fafd205e455")
        } else {
          d.setPort(CTPL.Port.SPP)
        }
        d.setBluetoothMacAddr(mac)

        // 超时兜底：15s 无回调即判失败，避免界面卡死
        connectTimeout?.let { mainHandler.removeCallbacks(it) }
        val timeout = Runnable {
          if (connecting) {
            connecting = false
            val p = pendingConnect
            pendingConnect = null
            try { CTPL.getInstance().disconnect() } catch (_: Exception) {}
            p?.reject("E_TIMEOUT", "连接超时，请确认打印机已开机并在范围内", null)
          }
        }
        connectTimeout = timeout
        mainHandler.postDelayed(timeout, 15000)

        CTPL.getInstance().connect(d)
      } catch (e: Exception) {
        connecting = false
        connectTimeout?.let { mainHandler.removeCallbacks(it) }
        pendingConnect = null
        promise.reject("E_CONNECT", e.message ?: "连接异常", e)
      }
    }

    // 查询打印机状态/配置（DPI、纸张、碳带、间隙等），结果走 "onData" 事件
    Function("queryStatus") {
      try {
        CTPL.getInstance().clean()
        CTPL.getInstance().queryHardwareConfig()
        CTPL.getInstance().queryDisplayInfo()
        CTPL.getInstance().queryPrintState()
        CTPL.getInstance().execute()
        true
      } catch (e: Exception) {
        false
      }
    }

    /**
     * 打印一批标签。
     * config = {
     *   widthMm, heightMm, dpi,
     *   qrXMm, qrYMm, qrCell,
     *   labels: [ { qr, copies, texts: [ {xMm, yMm, scale, text} ] } ]
     * }
     */
    AsyncFunction("printLabels") { config: Map<String, Any?>, promise: Promise ->
      if (!safeIsConnected()) {
        promise.reject("E_NOT_CONNECTED", "打印机未连接", null)
        return@AsyncFunction
      }
      val widthMm = (config["widthMm"] as? Number)?.toInt() ?: 60
      val heightMm = (config["heightMm"] as? Number)?.toInt() ?: 40
      val dpi = (config["dpi"] as? Number)?.toInt() ?: 203
      val dotsPerMm = dpi / 25.4
      val qrXMm = (config["qrXMm"] as? Number)?.toDouble() ?: 3.0
      val qrYMm = (config["qrYMm"] as? Number)?.toDouble() ?: 3.0
      val qrCell = (config["qrCell"] as? Number)?.toInt() ?: 5

      @Suppress("UNCHECKED_CAST")
      val labels = config["labels"] as? List<Map<String, Any?>> ?: emptyList()

      Thread {
        try {
          val ctpl = CTPL.getInstance()
          for (label in labels) {
            val copies = (label["copies"] as? Number)?.toInt() ?: 1
            if (copies <= 0) continue
            val qr = label["qr"] as? String ?: ""

            ctpl.clean()
            ctpl.setSize(widthMm, heightMm)
            ctpl.drawQRCode(
              Point((qrXMm * dotsPerMm).toInt(), (qrYMm * dotsPerMm).toInt()),
              QRLevel.ECC_M,
              qrCell,
              QREncodeMode.AUTO,
              qr,
            )

            @Suppress("UNCHECKED_CAST")
            val texts = label["texts"] as? List<Map<String, Any?>> ?: emptyList()
            for (t in texts) {
              val xMm = (t["xMm"] as? Number)?.toDouble() ?: 0.0
              val yMm = (t["yMm"] as? Number)?.toDouble() ?: 0.0
              val scale = (t["scale"] as? Number)?.toInt() ?: 1
              val text = t["text"] as? String ?: ""
              if (text.isEmpty()) continue
              ctpl.drawText(
                Point((xMm * dotsPerMm).toInt(), (yMm * dotsPerMm).toInt()),
                Rotate.Degree0,
                scale,
                scale,
                text,
              )
            }

            ctpl.print(copies)
            ctpl.execute()
            Thread.sleep(150)
          }
          promise.resolve(true)
        } catch (e: Exception) {
          promise.reject("E_PRINT", e.message ?: "打印失败", e)
        }
      }.start()
    }
  }

  private fun safeIsConnected(): Boolean = try {
    CTPL.getInstance().isConnected
  } catch (e: Exception) {
    false
  }

  private fun ensureInit() {
    if (initialized) return
    val app = appContext.reactContext?.applicationContext as? Application ?: return
    CTPL.getInstance().init(app, object : RespCallback {
      override fun onConnectRespsonse(port: Int, reason: Int) {
        sendEvent("onConnect", mapOf("port" to port, "reason" to reason))
        // reason==4 是「断开连接」通知（connect 前会先 disconnect 触发它），
        // 连接过程中忽略，避免把它误判成连接结果。
        if (reason == 4) return
        connecting = false
        connectTimeout?.let { mainHandler.removeCallbacks(it) }
        val p = pendingConnect
        pendingConnect = null
        // 256=BLE成功 257=SPP成功 258=USB成功
        if (reason == 256 || reason == 257 || reason == 258) {
          p?.resolve(reason)
        } else {
          p?.reject("E_CONNECT", "连接失败，代码=$reason", null)
        }
      }

      override fun onDataResponse(result: HashMap<String, String>?) {
        val map: Map<String, String> = result?.toMap() ?: emptyMap()
        sendEvent("onData", mapOf("data" to map))
      }

      override fun autoSPPBond(): Boolean = true
    })
    initialized = true
  }
}
