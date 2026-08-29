import { requireOptionalNativeModule } from "expo";
import { PermissionsAndroid, Platform } from "react-native";
import type {
  CtBondedDevice,
  CtPort,
  CtPrintJob,
} from "../../modules/ct-printer/src/CtPrinter.types";

type CtNativeModule = {
  getBondedDevices: () => CtBondedDevice[];
  isConnected: () => boolean;
  disconnect: () => void;
  connect: (mac: string, port: CtPort) => Promise<number>;
  queryStatus: () => boolean;
  printLabels: (job: CtPrintJob) => Promise<boolean>;
  isLocationEnabled?: () => boolean;
};

/**
 * 原生模块（Expo Go 中为 null，APK 中可用）。
 * 用 try/catch 兜底：即使原生模块加载异常，也绝不能让 App 启动期崩溃白屏。
 */
let Native: CtNativeModule | null = null;
try {
  Native = (requireOptionalNativeModule("CtPrinter") as CtNativeModule | null) ?? null;
} catch {
  Native = null;
}

/** 当前构建是否带蓝牙打印能力（Expo Go 为 false） */
export const isPrinterAvailable = Native != null;

/**
 * 申请 Android 蓝牙运行时权限。
 * 驰腾 SDK 连接时会校验权限，缺一即返回「516 权限不足」，因此这里把
 * SPP 与 BLE 两条路径所需的权限一次性申请齐全：
 * - 12+(API31)：BLUETOOTH_SCAN / CONNECT / ADVERTISE + 定位(FINE/COARSE)
 *   （SDK 的 SPP 校验仍会读取定位权限，所以必须一并申请）
 * - 12 以下：BLUETOOTH/ADMIN 为安装期权限，运行时只需定位
 */
export async function ensureBtPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    const P = PermissionsAndroid.PERMISSIONS;
    if (typeof Platform.Version === "number" && Platform.Version >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        P.BLUETOOTH_SCAN,
        P.BLUETOOTH_CONNECT,
        P.BLUETOOTH_ADVERTISE,
        P.ACCESS_FINE_LOCATION,
        P.ACCESS_COARSE_LOCATION,
      ]);
      // 蓝牙三项必须授予；定位至少授予其一（SPP 需要，BLE 也读取）
      const btOk =
        res[P.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
        res[P.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
      const locOk =
        res[P.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED ||
        res[P.ACCESS_COARSE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
      return btOk && locOk;
    }
    const granted = await PermissionsAndroid.request(P.ACCESS_FINE_LOCATION);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

/** 手机「位置/GPS」总开关是否打开（SPP 连接要求其为开） */
export function isLocationEnabled(): boolean {
  if (!Native?.isLocationEnabled) return true;
  try {
    return Native.isLocationEnabled();
  } catch {
    return true;
  }
}

export async function getBondedDevices(): Promise<CtBondedDevice[]> {
  if (!Native) return [];
  await ensureBtPermissions();
  return Native.getBondedDevices();
}

/** 连接打印机；resolve 为连接结果码（257=SPP, 256=BLE, 258=USB） */
export async function connectPrinter(mac: string, port: CtPort = "SPP"): Promise<number> {
  if (!Native) throw new Error("当前为 Expo Go，蓝牙打印需使用安装版 App");
  await ensureBtPermissions();
  return Native.connect(mac, port);
}

/** 把厂商连接错误码翻译成给店员看的中文建议 */
function explainConnectError(msg: string): string {
  if (/代码=516/.test(msg))
    return "权限不足：请允许「附近的设备/蓝牙」和「位置」权限，并打开手机的「位置/GPS」开关后重试";
  if (/代码=518/.test(msg)) return "SPP 配对失败：请到手机「系统设置→蓝牙」里重新配对这台打印机";
  if (/代码=519/.test(msg)) return "BLE 服务不匹配：该打印机可能不支持当前蓝牙服务";
  if (/代码=514/.test(msg)) return "打印机已连接，无需重复连接";
  if (/代码=512/.test(msg)) return "不支持的连接类型";
  // 其余未知错误码：保留码便于排查，同时给出可行动指引
  const code = msg.match(/代码=(\d+)/)?.[1];
  if (code) return `无法连接打印机（代码 ${code}）：请确认打印机已开机、在手机附近，然后重试`;
  return msg;
}

export interface ConnectResult {
  port: CtPort;
  code: number;
}

/**
 * 自动连接：先试 SPP（经典蓝牙），失败再回退 BLE。
 * - 连接前先 disconnect，避免「重复连接(514)」与状态残留导致的崩溃；
 * - 两条路径都失败时，抛出带中文建议的错误。
 */
export async function connectPrinterAuto(mac: string): Promise<ConnectResult> {
  if (!Native) throw new Error("当前为 Expo Go，蓝牙打印需使用安装版 App");
  const granted = await ensureBtPermissions();
  if (!granted) {
    throw new Error(
      "蓝牙/位置权限未授予。请到「系统设置→应用→本应用→权限」里允许「附近的设备」和「位置」后重试",
    );
  }

  try {
    Native.disconnect();
  } catch {
    // 忽略
  }

  let sppErr = "";
  try {
    const code = await Native.connect(mac, "SPP");
    return { port: "SPP", code };
  } catch (e) {
    sppErr = (e as Error).message ?? "";
  }

  // SPP 失败 → 回退 BLE
  try {
    Native.disconnect();
  } catch {
    // 忽略
  }
  try {
    const code = await Native.connect(mac, "BLE");
    return { port: "BLE", code };
  } catch (e) {
    const bleErr = (e as Error).message ?? "";
    // 优先用更有指导性的那条
    const primary = /代码=516/.test(sppErr) ? sppErr : bleErr || sppErr;
    throw new Error(explainConnectError(primary));
  }
}

export function isPrinterConnected(): boolean {
  return Native ? Native.isConnected() : false;
}

export function disconnectPrinter(): void {
  Native?.disconnect();
}

export async function printJob(job: CtPrintJob): Promise<boolean> {
  if (!Native) throw new Error("当前为 Expo Go，蓝牙打印需使用安装版 App");
  return Native.printLabels(job);
}
