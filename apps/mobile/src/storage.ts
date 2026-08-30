import * as SecureStore from "expo-secure-store";
import type { AuthUser } from "@cloth-scan/shared";

const TOKEN_KEY = "cloth_scan_token";
const SALE_ALERTS_KEY = "cloth_scan_sale_alerts_on";
const LAST_PRINTER_KEY = "cloth_scan_last_printer";
const CACHED_USER_KEY = "cloth_scan_cached_user";

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

/**
 * 缓存的用户身份（登录/校验成功后写入）。
 * 启动时先用它秒进主界面，/auth/me 在后台校验——网络不佳或离线时
 * 不再卡转圈、也不再被甩回登录页（token 仍在，仅界面缺身份）。
 */
let cachedUserCache: AuthUser | null | undefined;

export async function loadCachedUser(): Promise<AuthUser | null> {
  if (cachedUserCache !== undefined) return cachedUserCache;
  try {
    const raw = await SecureStore.getItemAsync(CACHED_USER_KEY);
    cachedUserCache = raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    cachedUserCache = null;
  }
  return cachedUserCache;
}

export async function saveCachedUser(u: AuthUser): Promise<void> {
  cachedUserCache = u;
  try {
    await SecureStore.setItemAsync(CACHED_USER_KEY, JSON.stringify(u));
  } catch {
    // 持久化失败不影响本次会话生效
  }
}

export async function clearCachedUser(): Promise<void> {
  cachedUserCache = null;
  try {
    await SecureStore.deleteItemAsync(CACHED_USER_KEY);
  } catch {
    // 忽略
  }
}
