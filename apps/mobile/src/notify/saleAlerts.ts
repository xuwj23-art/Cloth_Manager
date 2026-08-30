import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { SaleOrderDetail } from "@cloth-scan/shared";
import { listSales } from "../api";
import { getSaleAlertsOn } from "../storage";
import { yuan } from "../utils/format";
import { useSaleToast } from "./SaleToast";

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

/**
 * 提醒一笔新单：前台弹顶部提醒卡（不打断操作），退后台/锁屏走系统通知（声音+震动）。
 * 两条路径互斥，避免「横幅 + 卡片」双重打扰。
 */
function notifySale(o: SaleOrderDetail, presentSale: (order: SaleOrderDetail) => void): void {
  const who = o.operatorName ? ` · ${o.operatorName}` : "";
  const body = `${yuan(o.totalAmount)} · ${o.itemCount} 件${who}`;
  if (AppState.currentState === "active") {
    presentSale(o);
    return;
  }
  void Notifications.scheduleNotificationAsync({
    content: { title: "新结账", body, sound: "default" },
    trigger: null,
  }).catch(() => {
    // 通知失败不影响轮询
  });
}

/**
 * 老板专属：轮询云端销售流水，发现新结账（非本人开单）时提醒。
 *
 * 前台 → 顶部「新结账」提醒卡（SaleToast）；退后台/锁屏 → 系统通知栏（「结账提醒」渠道）。
 * 设置页「结账提醒」开关（getSaleAlertsOn）为总闸：关闭后轮询仍记录已见单据
 * （避免重新打开时补发一串旧提醒），但不做任何提醒。
 *
 * 覆盖范围（2026-08-30 模拟器实测）：App 在前台时可靠生效；退后台瞬间补一次轮询；
 * 回前台时补发期间的新单。**长时间停留在后台/锁屏时 Android 会暂停 JS 轮询，
 * 无法提醒**（国内无可靠免费远程推送，按约定暂不做远程通道）。
 */
export function useOwnerSaleAlerts(enabled: boolean, selfUserId: string | null) {
  const { presentSale } = useSaleToast();
  const seen = useRef<Set<string>>(new Set());
  const inited = useRef(false);
  const presentRef = useRef(presentSale);
  presentRef.current = presentSale;

  useEffect(() => {
    if (!enabled) return;
    ensureHandler();

    let cancelled = false;

    (async () => {
      if (!(await getSaleAlertsOn())) return; // 关闭状态不请求权限、不建渠道
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
        if (fresh.length === 0) return;
        if (!(await getSaleAlertsOn())) return; // 总闸关闭：只记账不提醒
        // 按时间正序提醒；跳过老板本人开的单
        for (const o of fresh.reverse()) {
          if (selfUserId && o.operatorId === selfUserId) continue;
          notifySale(o, presentRef.current);
        }
      } catch {
        // 离线/请求失败：静默，下个周期再试
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    const sub = AppState.addEventListener("change", (s) => {
      // 回前台补一次；退后台前也补一次（退后台瞬间 JS 仍存活，
      // 可把「刚发生」的新单以系统通知形式发出去）
      if (s === "active" || s === "background") void poll();
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, selfUserId]);
}
