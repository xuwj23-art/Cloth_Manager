import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "cloth_scan_token";
const SALE_ALERTS_KEY = "cloth_scan_sale_alerts_on";

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
