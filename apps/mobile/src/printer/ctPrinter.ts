import { requireOptionalNativeModule } from "expo";
import { PermissionsAndroid, Platform } from "react-native";
import type {
  CtBondedDevice,
  CtPort,
  CtPrintJob,
} from "../../modules/ct-printer/src/CtPrinter.types";

/** 原生模块（Expo Go 中为 null，APK 中可用） */
const Native = requireOptionalNativeModule("CtPrinter") as
  | {
      getBondedDevices: () => CtBondedDevice[];
      isConnected: () => boolean;
      disconnect: () => void;
      connect: (mac: string, port: CtPort) => Promise<number>;
      queryStatus: () => boolean;
      printLabels: (job: CtPrintJob) => Promise<boolean>;
    }
  | null;

/** 当前构建是否带蓝牙打印能力（Expo Go 为 false） */
export const isPrinterAvailable = Native != null;

/** 申请 Android 蓝牙运行时权限（12+ 用 BLUETOOTH_SCAN/CONNECT，旧版用定位） */
export async function ensureBtPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    if (typeof Platform.Version === "number" && Platform.Version >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return Object.values(res).every(
        (v) => v === PermissionsAndroid.RESULTS.GRANTED,
      );
    }
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export async function getBondedDevices(): Promise<CtBondedDevice[]> {
  if (!Native) return [];
  await ensureBtPermissions();
  return Native.getBondedDevices();
}

/** 连接打印机；resolve 为连接结果码（257=SPP, 256=BLE, 258=USB） */
export async function connectPrinter(
  mac: string,
  port: CtPort = "SPP",
): Promise<number> {
  if (!Native) throw new Error("当前为 Expo Go，蓝牙打印需使用安装版 App");
  await ensureBtPermissions();
  return Native.connect(mac, port);
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
