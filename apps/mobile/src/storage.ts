import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "cloth_scan_token";
const SALE_ALERTS_KEY = "cloth_scan_sale_alerts_on";
const LAST_PRINTER_KEY = "cloth_scan_last_printer";

export async function loadToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/** 结账提醒开关（设置页）：内存缓存避免轮询每 20s 读一次 SecureStore */
let saleAlertsCache: boolean | null = null;

/** 是否开启「新结账提醒」（默认开，保持 1.3.0 以来的体验） */
export async function getSaleAlertsOn(): Promise<boolean> {
  if (saleAlertsCache !== null) return saleAlertsCache;
  try {
    const v = await SecureStore.getItemAsync(SALE_ALERTS_KEY);
    saleAlertsCache = v !== "0";
  } catch {
    saleAlertsCache = true;
  }
  return saleAlertsCache;
}

export async function setSaleAlertsOn(on: boolean): Promise<void> {
  saleAlertsCache = on;
  try {
    await SecureStore.setItemAsync(SALE_ALERTS_KEY, on ? "1" : "0");
  } catch {
    // 持久化失败不影响本次会话生效
  }
}

/** 上次成功连接的蓝牙打印机（打印页掉线自动重连用） */
export interface LastPrinter {
  name: string;
  mac: string;
}

let lastPrinterCache: LastPrinter | null | undefined;

export async function getLastPrinter(): Promise<LastPrinter | null> {
  if (lastPrinterCache !== undefined) return lastPrinterCache;
  try {
    const raw = await SecureStore.getItemAsync(LAST_PRINTER_KEY);
    lastPrinterCache = raw ? (JSON.parse(raw) as LastPrinter) : null;
  } catch {
    lastPrinterCache = null;
  }
  return lastPrinterCache;
}

export async function setLastPrinter(p: LastPrinter): Promise<void> {
  lastPrinterCache = p;
  try {
    await SecureStore.setItemAsync(LAST_PRINTER_KEY, JSON.stringify(p));
  } catch {
    // 持久化失败不影响本次会话生效
  }
}
