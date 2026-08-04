import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useAudioPlayer } from "expo-audio";
import { cartItemCount, cartToSaleInput, cartTotalCents } from "@cloth-scan/shared";
import { applyLocalStockDelta, getCachedSkuByBarcode } from "../db/catalog";
import { enqueueSale } from "../db/outbox";
import { useSync } from "../sync/sync-context";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space } from "../theme/tokens";
import { yuan } from "../utils/format";
import { useCashierStore } from "./cashier/store";
import { CartList } from "./cashier/CartList";
import { CheckoutBar } from "./cashier/CheckoutBar";
import { ConfirmCard } from "./cashier/ConfirmCard";
import { ManualInputSheet } from "./cashier/ManualInputSheet";
import { PriceEditSheet } from "./cashier/PriceEditSheet";
import { DiscountSheet } from "./cashier/DiscountSheet";
import { NotFoundSheet } from "./cashier/NotFoundSheet";

type CashierNav = NativeStackNavigationProp<RootStackParamList, "Cashier">;

/** 绿色扫描框边长（dp） */
const FRAME_SIZE = 150;
type ScanResult = { data: string };

/** 生成客户端幂等 opId（设备本地唯一即可） */
function genOpId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
 * 扫码收银屏（瘦身后 ~200 行的壳）。
 *
 * 状态全部走 Zustand（store.ts）：购物车 / 待确认 SKU / 当前 Sheet / 整单优惠。
 * 本组件只保留：摄像头视图、扫码/手输查找、结算确认与提交（涉及网络/outbox/库存的副作用）。
 * UI 子组件：CartList / CheckoutBar + 5 个 Sheet（ConfirmCard/Manual/PriceEdit/Discount/NotFound）。
 */
export function CashierScreen() {
  const navigation = useNavigation<CashierNav>();
  const [permission, requestPermission] = useCameraPermissions();
  const { online, pendingCount, syncNow, refreshPending } = useSync();
  const [torch, setTorch] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // store 状态/动作
  const hint = useCashierStore((s) => s.hint);
  const setHint = useCashierStore((s) => s.setHint);
  const addPending = useCashierStore((s) => s.addPending);
  const showNotFound = useCashierStore((s) => s.showNotFound);
  const setSheet = useCashierStore((s) => s.setSheet);
  const resetAfterCheckout = useCashierStore((s) => s.resetAfterCheckout);

  // 扫码抑制：任一 Sheet 打开时不再识别（高频事件去重）
  const sheetOpenRef = useRef(false);

  // 扫码成功提示音
  const beep = useAudioPlayer(require("../../assets/beep.wav"));
  function playBeep() {
    try {
      beep.seekTo(0);
      beep.play();
    } catch {
      // 忽略
    }
  }

  /** 扫码/手输命中后：查缓存 → 命中弹确认卡，未命中弹 NotFound */
  async function lookupAndPrompt(barcode: string) {
    const cached = await getCachedSkuByBarcode(barcode);
    if (!cached) {
      haptic("error");
      showNotFound(barcode);
      return;
    }
    playBeep();
    haptic("success");
    addPending(cached);
  }

  async function handleScanned(e: ScanResult) {
    if (sheetOpenRef.current) return; // 已有弹卡，暂停识别
    sheetOpenRef.current = true; // 立即上锁，避免同一画面重复触发
    await lookupAndPrompt(e.data);
  }

  /** 手动输入提交（关闭本 Sheet 后走同一查找流程；上锁防扫码抢占） */
  function submitManualBarcode(barcode: string) {
    sheetOpenRef.current = true;
    void lookupAndPrompt(barcode);
  }

  function openDiscount() {
    const cart = useCashierStore.getState().cart;
    if (cart.length === 0) return;
    sheetOpenRef.current = true;
    setSheet("discount");
  }

  // ---- 权限态 ----
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.tip}>需要相机权限才能扫码</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>授予相机权限</Text>
        </Pressable>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.link}>返回</Text>
        </Pressable>
      </View>
    );
  }

  // ---- 结算 ----
  function checkout() {
    const { cart, orderDiscountCents } = useCashierStore.getState();
    if (cart.length === 0 || submitting) return;
    const orig = cartTotalCents(cart);
    const fin = Math.max(0, orig - orderDiscountCents);
    const cnt = cartItemCount(cart);
    const priceLine =
      fin < orig
        ? `合计 ${yuan(fin)}（原价 ${yuan(orig)} · 整单优惠 ${yuan(orig - fin)}）`
        : `合计 ${yuan(orig)}`;
    Alert.alert("确认结算", `共 ${cnt} 件商品，${priceLine}\n确认收款并记录这笔销售？`, [
      { text: "再看看", style: "cancel" },
      { text: "确认结算", onPress: () => void doCheckout() },
    ]);
  }

  async function doCheckout() {
    const { cart, orderDiscountCents } = useCashierStore.getState();
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      // 各行按原价入库；整单优惠作为订单级字段单独提交（第 2 波 Task 4）。
      const input = cartToSaleInput(cart, genOpId(), orderDiscountCents);
      await enqueueSale(input);
      for (const line of cart) {
        await applyLocalStockDelta(line.skuId, -line.quantity);
      }
      resetAfterCheckout();
      await refreshPending();
      void syncNow();
      Alert.alert(
        "已结算",
        online ? "销售已记录并正在同步到云端" : "当前离线，已记录在本地，联网后自动同步",
      );
    } catch (e) {
      Alert.alert("结算失败", (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // ---- 主视图 ----
  // 购物车/总价/件数等展示由 CartList 与 CheckoutBar 自行订阅 store；
  // 本组件无需订阅，仅在结算时通过 useCashierStore.getState() 读取快照。
  void setHint; // hint 已在 addPending/showNotFound 时由 store 写入

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={styles.link}>返回</Text>
        </Pressable>
        <Text style={styles.title}>扫码收银</Text>
        <Text style={[styles.netDot, online ? styles.online : styles.offline]}>
          {online ? "在线" : "离线"}
          {pendingCount > 0 ? ` · 待同步${pendingCount}` : ""}
        </Text>
      </View>

      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ["qr", "ean13", "code128"] }}
          onBarcodeScanned={(e) => void handleScanned(e as ScanResult)}
        />
        <View style={styles.frame} pointerEvents="none" />
        <Pressable
          style={[styles.torchBtn, torch && styles.torchOn]}
          onPress={() => setTorch((t) => !t)}
        >
          <Text style={styles.torchText}>{torch ? "💡 关灯" : "🔦 补光"}</Text>
        </Pressable>
      </View>

      <View style={styles.hintRow}>
        <Text style={styles.hint}>{hint}</Text>
        <Pressable onPress={() => setSheet("manual")} hitSlop={8}>
          <Text style={styles.manualLink}>手动输入</Text>
        </Pressable>
      </View>

      <CartList />

      <CheckoutBar onCheckout={checkout} onOpenDiscount={openDiscount} submitting={submitting} />

      {/* 5 个 Sheet 子组件，按 store.activeSheet / pendingSku 自行决定显隐 */}
      <ConfirmCard />
      <ManualInputSheet onSubmitBarcode={submitManualBarcode} />
      <PriceEditSheet />
      <DiscountSheet />
      <NotFoundSheet />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.card },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.lg,
    padding: space.xxl,
  },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  link: { color: colors.primary, fontSize: font.body },
  netDot: { fontSize: font.caption, fontWeight: "600" },
  online: { color: colors.online },
  offline: { color: colors.warn },
  cameraWrap: {
    height: 220,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: space.lg,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    borderWidth: 3,
    borderColor: "#4ADE80",
    borderRadius: radius.md,
  },
  torchBtn: {
    position: "absolute",
    bottom: 10,
    right: 10,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  torchOn: { backgroundColor: "rgba(245,158,11,0.85)" },
  torchText: { color: "#fff", fontSize: font.caption, fontWeight: "700" },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingVertical: space.sm,
  },
  hint: { color: colors.textMuted, fontSize: font.body },
  manualLink: { color: colors.primary, fontSize: font.body, fontWeight: "700" },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: space.xl + space.lg,
    borderRadius: radius.md,
  },
  btnText: { color: "#fff", fontSize: font.body, fontWeight: "700" },
  tip: { fontSize: font.body, color: colors.text },
});
