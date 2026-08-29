import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAudioPlayer } from "expo-audio";
import { cartItemCount, cartToSaleInput, cartTotalCents } from "@cloth-scan/shared";
import { applyLocalStockDelta, getCachedSkuByBarcode } from "../db/catalog";
import { enqueueSale } from "../db/outbox";
import { getDb } from "../db/database";
import { useSync } from "../sync/sync-context";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { BackButton } from "../components/BackButton";
import { useDialog } from "../dialog-context";
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

/** 取景器瞄准框边长（dp）与四角括角规格 */
const FRAME_SIZE = 140;
const CORNER_LEN = 32;
const CORNER_THICK = 3;
const GOLD = "#E8C98A";
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
  const { confirm, notice } = useDialog();
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

  // 同码短窗去重：摄像头对同一吊牌会连续触发多次识别
  const lastScanRef = useRef({ code: "", at: 0 });

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
    const st = useCashierStore.getState();
    if (st.activeSheet !== "none") return; // 已有弹卡，暂停识别
    const now = Date.now();
    if (lastScanRef.current.code === e.data && now - lastScanRef.current.at < 1500) return;
    lastScanRef.current = { code: e.data, at: now };
    await lookupAndPrompt(e.data);
  }

  /** 手动输入提交（关闭本 Sheet 后走同一查找流程） */
  function submitManualBarcode(barcode: string) {
    void lookupAndPrompt(barcode);
  }

  function openDiscount() {
    const cart = useCashierStore.getState().cart;
    if (cart.length === 0) return;
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
        <BackButton onPress={() => navigation.goBack()} />
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
    void confirm({
      title: "确认收款",
      message: `${cnt} 件 · ${priceLine}`,
      confirmLabel: "收款",
      cancelLabel: "取消",
    }).then((ok) => {
      if (ok) void doCheckout();
    });
  }

  async function doCheckout() {
    const { cart, orderDiscountCents } = useCashierStore.getState();
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      // 各行按原价入库；整单优惠作为订单级字段单独提交（第 2 波 Task 4）。
      const input = cartToSaleInput(cart, genOpId(), orderDiscountCents);
      // 入队与乐观扣库存放进同一 SQLite 事务：任一步失败整体回滚。
      // 否则「单已入队但扣库存抛错」会弹出失败提示，用户重试生成新 opId → 双单错账。
      const db = await getDb();
      await db.withTransactionAsync(async () => {
        await enqueueSale(input);
        for (const line of cart) {
          await applyLocalStockDelta(line.skuId, -line.quantity);
        }
      });
      resetAfterCheckout();
      await refreshPending();
      void syncNow();
      haptic("success");
    } catch (e) {
      await notice("收款失败", (e as Error).message);
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
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>扫码收银</Text>
        <View style={styles.net}>
          <View style={[styles.netDot, online ? styles.online : styles.offline]} />
          <Text style={[styles.netText, online ? styles.online : styles.offline]}>
            {online ? "在线" : "离线"}
            {pendingCount > 0 ? ` · ${pendingCount}` : ""}
          </Text>
        </View>
      </View>

      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ["qr", "ean13", "code128"] }}
          onBarcodeScanned={(e) => void handleScanned(e as ScanResult)}
        />
        {/* 深色压暗：让金括角与提示在任何衣物底色上可读 */}
        <View style={styles.scrim} pointerEvents="none" />
        {/* 动态提示：悬浮在取景器顶部 */}
        <View style={styles.hintPill} pointerEvents="none">
          <Ionicons name="scan-outline" size={13} color="rgba(255,255,255,0.85)" />
          <Text style={styles.hintPillText} numberOfLines={1}>
            {hint}
          </Text>
        </View>
        {/* 瞄准框：四角金色括角 */}
        <View style={styles.frame} pointerEvents="none">
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        <Pressable
          style={styles.manualChip}
          onPress={() => setSheet("manual")}
          accessibilityRole="button"
          accessibilityLabel="手动输入条码"
        >
          <Ionicons name="keypad-outline" size={14} color="#fff" />
          <Text style={styles.manualChipText}>手输条码</Text>
        </Pressable>
        <Pressable
          style={[styles.torchBtn, torch && styles.torchOn]}
          onPress={() => setTorch((t) => !t)}
          accessibilityRole="button"
          accessibilityLabel={torch ? "关闭补光灯" : "打开补光灯"}
        >
          <Ionicons name="flashlight" size={17} color="#fff" />
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
  container: { flex: 1, backgroundColor: colors.bg },
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
    backgroundColor: colors.card,
  },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  link: { color: colors.primary, fontSize: font.body },
  net: { flexDirection: "row", alignItems: "center", gap: 5 },
  netText: { fontSize: font.caption - 1, fontWeight: "600" },
  netDot: { width: 7, height: 7, borderRadius: 4 },
  online: { color: colors.online, backgroundColor: colors.online },
  offline: { color: colors.warn, backgroundColor: colors.warn },
  cameraWrap: {
    height: 232,
    backgroundColor: "#000",
    marginHorizontal: space.lg,
    marginTop: space.sm,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(13,22,44,0.38)" },
  hintPill: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    maxWidth: "82%",
    paddingHorizontal: 12,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: "rgba(13,22,44,0.72)",
  },
  hintPillText: { color: "rgba(255,255,255,0.88)", fontSize: 12, fontWeight: "600" },
  frame: {
    position: "absolute",
    top: 44,
    alignSelf: "center",
    width: FRAME_SIZE,
    height: FRAME_SIZE,
  },
  corner: {
    position: "absolute",
    width: CORNER_LEN,
    height: CORNER_LEN,
    borderColor: GOLD,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICK,
    borderLeftWidth: CORNER_THICK,
    borderTopLeftRadius: 10,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICK,
    borderRightWidth: CORNER_THICK,
    borderTopRightRadius: 10,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICK,
    borderLeftWidth: CORNER_THICK,
    borderBottomLeftRadius: 10,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICK,
    borderRightWidth: CORNER_THICK,
    borderBottomRightRadius: 10,
  },
  manualChip: {
    position: "absolute",
    bottom: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  manualChipText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  torchBtn: {
    position: "absolute",
    bottom: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  torchOn: { backgroundColor: "rgba(245,158,11,0.9)" },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: space.xl + space.lg,
    borderRadius: radius.md,
  },
  btnText: { color: "#fff", fontSize: font.body, fontWeight: "700" },
  tip: { fontSize: font.body, color: colors.text },
});
