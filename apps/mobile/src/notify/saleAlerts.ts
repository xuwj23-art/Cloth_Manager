import { useEffect, useRef } from "react";
import { Alert, AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { SaleOrderDetail } from "@cloth-scan/shared";
import { listSales } from "../api";

/** 轮询间隔（App 在前台/后台存活时生效） */
const POLL_MS = 20000;

let handlerSet = false;
function ensureHandler() {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

async function notifySale(o: SaleOrderDetail) {
  const who = o.operatorName ? `（收银：${o.operatorName}）` : "";
  const body = `${yuan(o.totalAmount)} · ${o.itemCount} 件${who}`;
  // 系统通知（带铃声）——前台/后台存活时都会在通知栏出现
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: "💰 新的结账", body, sound: "default" },
      trigger: null,
    });
  } catch {
    // 忽略：通知失败不影响其他逻辑
  }
  // 前台时再弹一个应用内弹窗，确保老板第一时间看到
  if (AppState.currentState === "active") {
    Alert.alert("💰 新的结账", body);
  }
}

/**
 * 老板专属：轮询云端销售流水，发现新结账（非本人开单）时弹窗 + 铃声 + 通知栏提醒。
 *
 * 覆盖范围：App 在前台、或退到后台但进程仍存活时。
 * 局限：被系统彻底杀掉进程后无法收到（国内无可靠免费远程推送，按约定暂不做）。
 */
export function useOwnerSaleAlerts(enabled: boolean, selfUserId: string | null) {
  const seen = useRef<Set<string>>(new Set());
  const inited = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    ensureHandler();

    let cancelled = false;

    (async () => {
      try {
        const perm = await Notifications.getPermissionsAsync();
        if (!perm.granted) await Notifications.requestPermissionsAsync();
      } catch {
        // 忽略
      }
      if (Platform.OS === "android") {
        try {
          await Notifications.setNotificationChannelAsync("sales", {
            name: "结账提醒",
            importance: Notifications.AndroidImportance.HIGH,
            sound: "default",
            vibrationPattern: [0, 250, 250, 250],
          });
        } catch {
          // 忽略
        }
      }
    })();

    async function poll() {
      try {
        const orders = await listSales();
        if (cancelled) return;
        if (!inited.current) {
          // 首次加载：记录现有单据，避免对历史订单补发提醒
          for (const o of orders) seen.current.add(o.id);
          inited.current = true;
          return;
        }
        const fresh = orders.filter((o) => !seen.current.has(o.id));
        for (const o of orders) seen.current.add(o.id);
        // 按时间正序提醒；跳过老板本人开的单
        for (const o of fresh.reverse()) {
          if (selfUserId && o.operatorId === selfUserId) continue;
          await notifySale(o);
        }
      } catch {
        // 离线/请求失败：静默，下个周期再试
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void poll();
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, selfUserId]);
}
