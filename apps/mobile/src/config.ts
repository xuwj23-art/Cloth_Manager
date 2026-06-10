import { API_PREFIX } from "@cloth-scan/shared";

/**
 * 后端地址。
 * - 生产/试运行：阿里云服务器公网地址（当前值）。
 * - 本地真机调试：改成「你电脑在局域网的 IP」，且手机与电脑同一 WiFi，例如 http://192.168.1.100:3000。
 * - Android 模拟器访问本机：http://10.0.2.2:3000。
 */
export const API_HOST = "http://39.108.186.58:3000";

export const API_BASE = `${API_HOST}${API_PREFIX}`;

/** 演示门店 ID：运行后端 `pnpm server db:seed` 后，把打印出的门店ID填到这里 */
export const DEMO_SHOP_ID = "";
