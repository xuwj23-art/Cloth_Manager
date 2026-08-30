import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import QRCode from "react-native-qrcode-svg";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import {
  connectPrinterAuto,
  disconnectPrinter,
  getBondedDevices,
  isLocationEnabled,
  isPrinterAvailable,
  isPrinterConnected,
  onCtConnectEvent,
  printJob,
} from "../printer/ctPrinter";
import { buildCtPrintJob, totalLabelCount } from "../printer/labelLayout";
import type { CtBondedDevice } from "../../modules/ct-printer/src/CtPrinter.types";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { BackButton } from "../components/BackButton";
import { useDialog } from "../dialog-context";
import { getLastPrinter, setLastPrinter } from "../storage";
import { colors, font, radius, space } from "../theme/tokens";
import { yuan } from "../utils/format";

type LabelPrintNav = NativeStackNavigationProp<RootStackParamList, "LabelPrint">;
type LabelPrintRoute = RouteProp<RootStackParamList, "LabelPrint">;

/** 常见服装吊牌/不干胶尺寸（mm） */
const LABEL_SIZES = [
  { id: "60x40", label: "60×40", w: 60, h: 40 },
  { id: "40x30", label: "40×30", w: 40, h: 30 },
  { id: "50x30", label: "50×30", w: 50, h: 30 },
  { id: "40x60", label: "40×60", w: 40, h: 60 },
] as const;

const ORIENTATIONS = [
  { id: "portrait", label: "纵向" },
  { id: "landscape", label: "横向" },
] as const;

type Orientation = (typeof ORIENTATIONS)[number]["id"];
type LabelSize = (typeof LABEL_SIZES)[number];

/**
 * 仅开发构建（__DEV__）使用的虚拟已配对设备：Android 模拟器没有真实蓝牙，
 * 用于在模拟器上走通「连接中 / 失败 / 重试」的 UI 状态。生产包不受影响。
 */
const DEV_FIXTURE_DEVICES: CtBondedDevice[] = [{ name: "X1（调试）", mac: "00:11:22:33:44:55" }];

/** 连接状态机：connecting 连接中（雷达动画）；success 已连上（对勾弹出，短驻自动关）；failed 失败（原因 + 重试） */
interface ConnectState {
  mac: string;
  name: string;
  phase: "connecting" | "success" | "failed";
  msg?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 把 QRCode 组件 ref 转成 base64 PNG（无 data: 前缀） */
function refToDataURL(
  ref: { toDataURL?: (cb: (d: string) => void) => void } | undefined,
): Promise<string> {
  return new Promise((resolve) => {
    if (!ref?.toDataURL) {
      resolve("");
      return;
    }
    ref.toDataURL((data: string) => resolve(data));
  });
}

interface LabelItem {
  qr: string;
  code: string;
}

function buildLabelsHtml(labels: LabelItem[], size: LabelSize, orientation: Orientation): string {
  const portrait = orientation === "portrait";
  // 纵向：物理标签仍是 size.w×size.h，但内容按 (h×w) 排版后旋转 90° 填入
  const innerW = portrait ? size.h : size.w;
  const innerH = portrait ? size.w : size.h;
  const cells = labels
    .map(
      (l) => `
    <div class="label" style="width:${size.w}mm;height:${size.h}mm;">
      <div class="inner" style="width:${innerW}mm;height:${innerH}mm;${
        portrait ? "transform:rotate(90deg);" : ""
      }">
        <img class="qr" src="data:image/png;base64,${l.qr}"/>
        <div class="code">${escapeHtml(l.code)}</div>
      </div>
    </div>`,
    )
    .join("");
  // 居中竖排：大二维码（主视觉）→ SKU 条码
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    *{box-sizing:border-box;}
    body{margin:0;padding:4mm;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;}
    .label{border:1px dashed #bbb;margin:1mm;float:left;overflow:hidden;
      display:flex;align-items:center;justify-content:center;}
    .inner{display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:1.5mm;overflow:hidden;}
    .qr{height:64%;width:auto;aspect-ratio:1;}
    .code{font-size:7pt;letter-spacing:0.3px;color:#222;margin-top:1.2mm;
      max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;}
  </style></head><body>${cells}</body></html>`;
}

/** 触感反馈（部分设备不支持时静默忽略） */
function haptic(kind: "success" | "error" | "light") {
  try {
    if (kind === "success") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (kind === "error") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch {
    // 忽略
  }
}

/**
 * 连接中信号条：三根错峰呼吸的竖条（配对/传输场景的通用视觉词汇），
 * 取代干巴巴的系统转圈，让「正在连接」一眼可读。挂载即循环，卸载自动停止。
 */
function SignalBars({ color = "#fff", barWidth = 3 }: { color?: string; barWidth?: number }) {
  const v0 = useRef(new Animated.Value(0.35)).current;
  const v1 = useRef(new Animated.Value(0.35)).current;
  const v2 = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const anims = [v0, v1, v2].map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(v, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.35, duration: 320, useNativeDriver: true }),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [v0, v1, v2]);
  return (
    <View style={signalStyles.row}>
      {[
        { v: v0, h: 6 },
        { v: v1, h: 11 },
        { v: v2, h: 16 },
      ].map((b, i) => (
        <Animated.View
          key={i}
          style={[
            signalStyles.bar,
            { height: b.h, width: barWidth, backgroundColor: color, opacity: b.v },
          ]}
        />
      ))}
    </View>
  );
}

const signalStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 2.5, height: 16 },
  bar: { borderRadius: 1.5 },
});

/**
 * 连接中雷达动画：中心蓝牙图标 + 两圈错峰扩散的涟漪环，
 * 表达「正在搜寻/建立连接」。挂载即循环，原生驱动，卸载自动停止。
 */
function RadarConnect({ size = 120 }: { size?: number }) {
  const r1 = useRef(new Animated.Value(0)).current;
  const r2 = useRef(new Animated.Value(0)).current;
  const iconPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const ring1 = Animated.loop(
      Animated.timing(r1, { toValue: 1, duration: 1600, useNativeDriver: true }),
    );
    const ring2 = Animated.loop(
      Animated.sequence([
        Animated.delay(800),
        Animated.timing(r2, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ]),
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(iconPulse, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(iconPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    ring1.start();
    ring2.start();
    pulse.start();
    return () => {
      ring1.stop();
      ring2.stop();
      pulse.stop();
    };
  }, [r1, r2, iconPulse]);

  const ringStyle = (v: Animated.Value) => ({
    position: "absolute" as const,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 2.5,
    borderColor: colors.primary,
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.3] }) }],
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
  });

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={ringStyle(r1)} pointerEvents="none" />
      <Animated.View style={ringStyle(r2)} pointerEvents="none" />
      <Animated.View
        style={{
          width: size * 0.5,
          height: size * 0.5,
          borderRadius: (size * 0.5) / 2,
          backgroundColor: colors.primarySoft,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale: iconPulse }],
        }}
      >
        <Ionicons name="bluetooth" size={26} color={colors.primary} />
      </Animated.View>
    </View>
  );
}

/** 成功对勾：弹性放大进场（一次性） */
function SuccessCheck({ size = 84 }: { size?: number }) {
  const pop = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
  }, [pop]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "rgba(22,163,74,0.12)",
        alignItems: "center",
        justifyContent: "center",
        transform: [{ scale: pop }],
      }}
    >
      <Ionicons name="checkmark-circle" size={size * 0.62} color={colors.online} />
    </Animated.View>
  );
}

/**
 * 连接状态二级弹窗：覆盖在设备列表弹层之上，设备列表保持干净。
 * - connecting：雷达动画 + 预期文案（无按钮，连接不可中断，最长约 15 秒自动出结果）
 * - success：对勾弹出，约 1 秒后自动关闭（设备列表一并收起）
 * - failed：失败原因（完整多行）+ 重试 / 返回列表
 */
function ConnectDialog({
  state,
  onRetry,
  onClose,
}: {
  state: ConnectState;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { phase, name } = state;
  // success 短驻自动关闭由父组件计时，这里只负责展示
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => phase === "failed" && onClose()}
    >
      <View style={styles.cdMask}>
        <View style={styles.cdCard}>
          {phase === "connecting" ? (
            <>
              <RadarConnect />
              <Text style={styles.cdTitle}>正在连接「{name}」</Text>
              <Text style={styles.cdSub}>约需 3~15 秒，请保持打印机开机</Text>
              <Text style={styles.cdSubMuted}>请勿锁屏或离开本页</Text>
            </>
          ) : phase === "success" ? (
            <>
              <SuccessCheck />
              <Text style={[styles.cdTitle, { color: colors.online }]}>已连接</Text>
              <Text style={styles.cdSub}>{name}</Text>
            </>
          ) : (
            <>
              <View style={styles.cdFailIcon}>
                <Ionicons name="close-circle" size={46} color={colors.danger} />
              </View>
              <Text style={[styles.cdTitle, { color: colors.danger }]}>连接失败</Text>
              <Text style={styles.cdReason}>{state.msg}</Text>
              <View style={styles.cdActions}>
                <Pressable style={styles.cdSecondary} onPress={onClose}>
                  <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
                  <Text style={styles.cdSecondaryText}>返回列表</Text>
                </Pressable>
                <Pressable style={styles.cdPrimary} onPress={onRetry}>
                  <Ionicons name="refresh" size={16} color="#fff" />
                  <Text style={styles.cdPrimaryText}>重试</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** 单台已配对设备的行：状态反馈统一走二级弹窗，列表只负责展示与点选 */
function DeviceRow({
  dev,
  disabled,
  onConnect,
}: {
  dev: CtBondedDevice;
  disabled: boolean;
  onConnect: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.devRow,
        pressed && styles.devRowPressed,
        disabled && styles.devRowDim,
      ]}
      disabled={disabled}
      android_ripple={{ color: "rgba(37,99,235,0.10)", borderless: false }}
      onPress={onConnect}
      accessibilityRole="button"
      accessibilityLabel={`连接打印机 ${dev.name}`}
    >
      <View style={styles.devIconChip}>
        <Ionicons name="bluetooth" size={20} color={colors.primary} />
      </View>
      <View style={styles.devInfo}>
        <Text style={styles.devName}>{dev.name}</Text>
        <Text style={styles.devMac}>{dev.mac}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#C7CDD6" />
    </Pressable>
  );
}

export function LabelPrintScreen() {
  const navigation = useNavigation<LabelPrintNav>();
  const route = useRoute<LabelPrintRoute>();
  const { notice } = useDialog();
  const { product } = route.params;
  const [size, setSize] = useState<LabelSize>(LABEL_SIZES[0]);
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(product.skus.map((s) => [s.id, 1])),
  );
  const [busy, setBusy] = useState(false);
  const refs = useRef<Map<string, { toDataURL?: (cb: (d: string) => void) => void }>>(new Map());
  const [btOpen, setBtOpen] = useState(false);
  const [devices, setDevices] = useState<CtBondedDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connected, setConnected] = useState(isPrinterConnected());
  const [connect, setConnect] = useState<ConnectState | null>(null);

  function setQtyFor(id: string, n: number) {
    setQty((prev) => ({ ...prev, [id]: Math.max(0, n) }));
  }

  function fillByStock() {
    setQty(Object.fromEntries(product.skus.map((s) => [s.id, Math.max(s.stock, 0)])));
  }

  async function collectLabels(): Promise<LabelItem[]> {
    const labels: LabelItem[] = [];
    for (const sku of product.skus) {
      const q = qty[sku.id] ?? 0;
      if (q <= 0) continue;
      const data = await refToDataURL(refs.current.get(sku.id));
      if (!data) continue;
      const item: LabelItem = {
        qr: data,
        code: sku.barcode,
      };
      for (let i = 0; i < q; i++) labels.push(item);
    }
    return labels;
  }

  async function handlePrint() {
    setBusy(true);
    try {
      const labels = await collectLabels();
      if (labels.length === 0) {
        await notice("请选择打印份数");
        return;
      }
      await Print.printAsync({ html: buildLabelsHtml(labels, size, orientation) });
    } catch (e) {
      await notice("打印失败", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSharePdf() {
    setBusy(true);
    try {
      const labels = await collectLabels();
      if (labels.length === 0) {
        await notice("请选择打印份数");
        return;
      }
      const { uri } = await Print.printToFileAsync({
        html: buildLabelsHtml(labels, size, orientation),
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
      } else {
        await notice("已生成 PDF");
      }
    } catch (e) {
      await notice("生成失败", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openBluetooth() {
    setBtOpen(true);
    setConnect(null);
    setScanning(true);
    try {
      const list = await getBondedDevices();
      // 模拟器无真实蓝牙：开发构建下用虚拟设备走通连接 UI（生产包不走这里）
      setDevices(list.length > 0 || !__DEV__ ? list : DEV_FIXTURE_DEVICES);
    } catch (e) {
      await notice("无法读取蓝牙设备", (e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function doConnect(dev: CtBondedDevice) {
    if (connect?.phase === "connecting") return;
    haptic("light");
    setConnect({ mac: dev.mac, name: dev.name, phase: "connecting" });
    try {
      await connectPrinterAuto(dev.mac);
      setConnected(true);
      await setLastPrinter({ name: dev.name, mac: dev.mac });
      haptic("success");
      setConnect({ mac: dev.mac, name: dev.name, phase: "success" });
    } catch (e) {
      const msg = (e as Error).message;
      let hint = msg;
      // 若是权限/位置类失败，且系统定位没开，给出更明确指引
      if (/权限|516|位置/.test(msg) && !isLocationEnabled()) {
        hint = "请打开手机定位后重试";
      }
      setConnect({ mac: dev.mac, name: dev.name, phase: "failed", msg: hint });
      haptic("error");
    }
  }

  /**
   * 静默重连指定打印机（点「蓝牙打印」时发现掉线的自动路径）。
   * 连接中有雷达弹窗反馈；失败时静默收起弹窗（由调用方决定后续，如转设备列表）。
   */
  async function tryReconnect(dev: { name: string; mac: string }): Promise<boolean> {
    haptic("light");
    setConnect({ mac: dev.mac, name: dev.name, phase: "connecting" });
    try {
      await connectPrinterAuto(dev.mac);
      setConnected(true);
      await setLastPrinter(dev);
      haptic("success");
      setConnect({ mac: dev.mac, name: dev.name, phase: "success" });
      return true;
    } catch {
      // 重连失败：底栏必须同步回落到「未连接」，避免「已连接 + 设备列表」同屏
      setConnected(false);
      setConnect(null);
      haptic("error");
      return false;
    }
  }

  // 断线即时感知：订阅 SDK onConnect 回调（原生在 sendEvent 后才过滤 reason=4，
  // 断线事件实际已发到 JS，此前只是没人听）。reason=4 立即把底栏打成「未连接」，
  // 成功码同步置「已连接」——不再依赖 2.5s 轮询兜底。
  useEffect(() => {
    if (!isPrinterAvailable) return;
    return onCtConnectEvent((reason) => {
      if (reason === 4) {
        setConnected(false);
      } else if (reason === 256 || reason === 257 || reason === 258) {
        setConnected(true);
      }
    });
  }, []);

  // 掉线感知：页面存续期间轮询 SDK 真实连接状态，底栏不再停留在过期的「已连接」。
  // 连接过程中跳过（此时 isConnected 短暂为 false 属正常，避免误刷成「未连接」）。
  useEffect(() => {
    if (!isPrinterAvailable) return;
    const id = setInterval(() => {
      if (connect?.phase === "connecting") return;
      const live = isPrinterConnected();
      setConnected((prev) => (prev === live ? prev : live));
    }, 2500);
    return () => clearInterval(id);
  }, [connect?.phase]);

  // success 短驻展示后自动收起二级弹窗与设备列表
  useEffect(() => {
    if (connect?.phase !== "success") return;
    const t = setTimeout(() => {
      setConnect(null);
      setBtOpen(false);
    }, 1000);
    return () => clearTimeout(t);
  }, [connect?.phase]);

  async function handleBtPrint() {
    if (!isPrinterConnected()) {
      // 掉线：优先静默重连「上次成功连接」的打印机，失败才转设备列表
      const last = await getLastPrinter();
      if (last && (await tryReconnect(last))) {
        // 重连成功，继续打印
      } else {
        await openBluetooth();
        return;
      }
    }
    const job = buildCtPrintJob(product, qty, {
      size: { widthMm: size.w, heightMm: size.h },
      orientation,
    });
    if (job.labels.length === 0) {
      await notice("请选择打印份数");
      return;
    }
    setBusy(true);
    try {
      await printJob(job);
      await notice("已发送打印", `${totalLabelCount(job)} 张`);
    } catch (e) {
      await notice("打印失败", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const totalLabels = product.skus.reduce((s, k) => s + (qty[k.id] ?? 0), 0);
  const connecting = connect?.phase === "connecting";

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>打印吊牌</Text>
        <Pressable onPress={fillByStock} hitSlop={8}>
          <Text style={styles.fillLink}>按库存</Text>
        </Pressable>
      </View>

      <View style={styles.sizeRow}>
        <Text style={styles.sizeLabel}>标签尺寸(mm)</Text>
        {LABEL_SIZES.map((s) => (
          <Pressable
            key={s.id}
            style={[styles.sizeChip, size.id === s.id && styles.sizeChipOn]}
            onPress={() => setSize(s)}
          >
            <Text style={[styles.sizeChipText, size.id === s.id && styles.sizeChipTextOn]}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.sizeRow}>
        <Text style={styles.sizeLabel}>打印方向</Text>
        {ORIENTATIONS.map((o) => (
          <Pressable
            key={o.id}
            style={[styles.sizeChip, orientation === o.id && styles.sizeChipOn]}
            onPress={() => setOrientation(o.id)}
          >
            <Text style={[styles.sizeChipText, orientation === o.id && styles.sizeChipTextOn]}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {product.skus.map((sku) => (
          <View key={sku.id} style={styles.card}>
            <View style={styles.qrBox}>
              <QRCode
                value={sku.barcode}
                size={72}
                getRef={(c) => {
                  if (c) refs.current.set(sku.id, c);
                }}
              />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.name} numberOfLines={1}>
                {product.name}
              </Text>
              <Text style={styles.spec}>
                {sku.color}/{sku.size} · 库存 {sku.stock}
              </Text>
              <Text style={styles.price}>{yuan(sku.salePrice)}</Text>
            </View>
            <View style={styles.stepper}>
              <Pressable
                style={styles.stepBtn}
                onPress={() => setQtyFor(sku.id, (qty[sku.id] ?? 0) - 1)}
              >
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Text style={styles.qtyText}>{qty[sku.id] ?? 0}</Text>
              <Pressable
                style={styles.stepBtn}
                onPress={() => setQtyFor(sku.id, (qty[sku.id] ?? 0) + 1)}
              >
                <Text style={styles.stepText}>＋</Text>
              </Pressable>
            </View>
          </View>
        ))}
        <Text style={styles.hint}>
          二维码内容即该规格的唯一条码，扫码收银可直接匹配。先用普通打印机 +
          不干胶标签纸即可；后续接蓝牙标签机一键打印。
        </Text>
      </ScrollView>

      {isPrinterAvailable ? (
        <View style={styles.btBar}>
          <View style={styles.btStatus}>
            <View
              style={[
                styles.btChip,
                connecting ? styles.btChipBusy : connected ? styles.btChipOn : styles.btChipOff,
              ]}
            >
              {connecting ? (
                <SignalBars color={colors.primary} />
              ) : (
                <Ionicons
                  name={connected ? "bluetooth" : "bluetooth"}
                  size={15}
                  color={connected ? colors.online : "#9CA3AF"}
                />
              )}
            </View>
            <Text
              style={[
                styles.btStatusText,
                connecting && { color: colors.primary, fontWeight: "700" },
                connected && { color: colors.online, fontWeight: "700" },
              ]}
            >
              {connecting ? "正在连接打印机…" : connected ? "蓝牙打印机已连接" : "蓝牙打印机未连接"}
            </Text>
          </View>
          {connected ? (
            <Pressable
              onPress={() => {
                disconnectPrinter();
                setConnected(false);
              }}
              hitSlop={8}
            >
              <Text style={styles.btLink}>断开</Text>
            </Pressable>
          ) : (
            <Pressable onPress={openBluetooth} hitSlop={8}>
              <Text style={styles.btLink}>选择设备</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      <View style={styles.footer}>
        <Pressable
          style={[styles.secondaryBtn, busy && styles.dim]}
          disabled={busy}
          onPress={handleSharePdf}
        >
          <Text style={styles.secondaryText}>生成 PDF 分享</Text>
        </Pressable>
        {isPrinterAvailable ? (
          <Pressable
            style={[styles.primaryBtn, (busy || totalLabels === 0) && styles.dim]}
            disabled={busy || totalLabels === 0}
            onPress={handleBtPrint}
          >
            <Text style={styles.primaryText}>
              {connected ? `蓝牙打印（${totalLabels}）` : "连接并打印"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primaryBtn, (busy || totalLabels === 0) && styles.dim]}
            disabled={busy || totalLabels === 0}
            onPress={handlePrint}
          >
            <Text style={styles.primaryText}>打印 / 导出（{totalLabels}）</Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={btOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!connecting) setBtOpen(false);
        }}
      >
        <View style={styles.modalMask}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>选择蓝牙打印机</Text>
              <Pressable onPress={openBluetooth} hitSlop={8} disabled={scanning || connecting}>
                <Text style={[styles.btLink, (scanning || connecting) && styles.btLinkDim]}>
                  {scanning ? "刷新中…" : "刷新"}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.modalHint}>
              请先在手机「系统设置 → 蓝牙」里配对打印机，再回到这里选择。
            </Text>
            {scanning ? (
              <ActivityIndicator style={{ marginVertical: 20 }} />
            ) : devices.length === 0 ? (
              <View style={styles.emptyBlock}>
                <Ionicons name="hardware-chip-outline" size={30} color="#9CA3AF" />
                <Text style={styles.emptyTitle}>未找到已配对设备</Text>
                <Text style={styles.emptyHint}>
                  打开手机「系统设置 → 蓝牙」，长按打印机完成配对后，点右上角「刷新」
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 300 }}>
                {devices.map((d) => (
                  <DeviceRow
                    key={d.mac}
                    dev={d}
                    disabled={connecting}
                    onConnect={() => void doConnect(d)}
                  />
                ))}
              </ScrollView>
            )}
            <Pressable
              style={[styles.modalClose, connecting && styles.dim]}
              disabled={connecting}
              onPress={() => setBtOpen(false)}
            >
              <Text style={styles.modalCloseText}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 连接状态二级弹窗：覆盖在设备列表之上，列表本身保持干净 */}
      {connect ? (
        <ConnectDialog
          state={connect}
          onRetry={() => void doConnect(devices.find((d) => d.mac === connect.mac)!)}
          onClose={() => setConnect(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  back: { color: "#2563eb", fontSize: 16 },
  title: { fontSize: 18, fontWeight: "800", color: "#111" },
  fillLink: { color: "#2563eb", fontSize: 14, fontWeight: "700" },
  sizeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sizeLabel: { fontSize: 13, color: "#6b7280", marginRight: 4 },
  sizeChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  sizeChipOn: { backgroundColor: "#2563eb" },
  sizeChipText: { fontSize: 13, color: "#6b7280", fontWeight: "600" },
  sizeChipTextOn: { color: "#fff" },
  body: { padding: 16, gap: 10 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
  },
  qrBox: {
    width: 84,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  cardInfo: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: "700", color: "#111" },
  spec: { fontSize: 13, color: "#6b7280" },
  price: { fontSize: 15, fontWeight: "800", color: "#111" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 18, fontWeight: "700", color: "#111" },
  qtyText: { minWidth: 24, textAlign: "center", fontSize: 16, fontWeight: "700" },
  hint: { fontSize: 12, color: "#9ca3af", lineHeight: 18, marginTop: 4 },
  footer: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#2563eb",
  },
  secondaryText: { color: "#2563eb", fontSize: 15, fontWeight: "700" },
  primaryBtn: {
    flex: 1.4,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#2563eb",
  },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  dim: { opacity: 0.5 },

  // ---- 底部蓝牙状态栏 ----
  btBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  btStatus: { flexDirection: "row", alignItems: "center", gap: 8 },
  btChip: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  btChipOn: { backgroundColor: "rgba(22,163,74,0.12)" },
  btChipOff: { backgroundColor: "#f3f4f6" },
  btChipBusy: { backgroundColor: colors.primarySoft },
  btStatusText: { fontSize: 13, color: "#374151", fontWeight: "600" },
  btLink: { color: "#2563eb", fontSize: 14, fontWeight: "700" },
  btLinkDim: { color: "#cbd5e1" },

  // ---- 设备选择弹层 ----
  modalMask: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
    paddingBottom: 28,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: { fontSize: 17, fontWeight: "800", color: "#111" },
  modalHint: { fontSize: 12, color: "#9ca3af", marginTop: 6, lineHeight: 18 },
  emptyBlock: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 26,
    paddingHorizontal: space.lg,
  },
  emptyTitle: { fontSize: font.body, fontWeight: "700", color: "#374151" },
  emptyHint: { fontSize: font.caption, color: "#9ca3af", textAlign: "center", lineHeight: 20 },

  // ---- 设备行 ----
  devRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: space.sm,
    marginHorizontal: -space.sm,
    borderRadius: radius.md,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  devRowPressed: { backgroundColor: "rgba(37,99,235,0.06)" },
  devRowDim: { opacity: 0.45 },
  devIconChip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  devInfo: { flex: 1, gap: 2, minWidth: 0 },
  devName: { fontSize: 15, fontWeight: "700", color: "#111" },
  devMac: { fontSize: 12, color: "#9ca3af" },
  modalClose: {
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#f3f4f6",
  },
  modalCloseText: { fontSize: 15, fontWeight: "700", color: "#374151" },

  // ---- 连接状态二级弹窗 ----
  cdMask: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: space.xxl,
  },
  cdCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#fff",
    borderRadius: radius.xl,
    padding: space.xxl,
    alignItems: "center",
    gap: space.md,
  },
  cdTitle: { fontSize: font.title, fontWeight: "800", color: colors.text },
  cdSub: { fontSize: font.body, color: "#374151", textAlign: "center" },
  cdSubMuted: { fontSize: font.caption, color: "#9ca3af", marginTop: -space.xs },
  cdFailIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.dangerSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cdReason: {
    fontSize: font.caption,
    color: "#B91C1C",
    lineHeight: 21,
    textAlign: "center",
  },
  cdActions: { flexDirection: "row", gap: space.md, marginTop: space.sm, alignSelf: "stretch" },
  cdSecondary: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  cdSecondaryText: { fontSize: font.body, fontWeight: "700", color: colors.textMuted },
  cdPrimary: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  cdPrimaryText: { fontSize: font.body, fontWeight: "800", color: "#fff" },
});
