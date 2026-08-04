import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useAudioPlayer } from "expo-audio";
import {
  addToCartQty,
  cartItemCount,
  cartToSaleInput,
  cartTotalCents,
  removeFromCart,
  setLinePrice,
  setQuantity,
  type CartLine,
} from "@cloth-scan/shared";
import {
  applyLocalStockDelta,
  getCachedSkuByBarcode,
  toScannedSku,
  type CachedSku,
} from "../db/catalog";
import { enqueueSale } from "../db/outbox";
import { imageUrl, thumbUrl } from "../api";
import { ImageViewer } from "../components/ImageViewer";
import { useSync } from "../sync/sync-context";

/** 绿色扫描框边长（dp），与样式 frame 保持一致 */
const FRAME_SIZE = 150;

/** 扫码事件中需要用到的字段（只用 data；绿框仅作视觉提示，不做范围限制） */
type ScanResult = { data: string };

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 生成客户端幂等 opId（设备本地唯一即可） */
function genOpId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 计算整单优惠后的最终总价（分）。zhe=按折扣，total=按优惠后总价；夹在 [0, 原价] */
function computeFinalTotal(
  cart: CartLine[],
  kind: "none" | "zhe" | "total",
  value: number,
): number {
  const orig = cartTotalCents(cart);
  if (kind === "zhe") {
    if (!(value > 0 && value < 10)) return orig;
    return Math.min(orig, Math.round((orig * value) / 10));
  }
  if (kind === "total") return Math.min(orig, Math.max(0, value));
  return orig;
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

export function CashierScreen({ onBack }: { onBack: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const { online, pendingCount, syncNow, refreshPending } = useSync();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [hint, setHint] = useState<string>("对准吊牌二维码扫描");
  const [submitting, setSubmitting] = useState(false);
  const [torch, setTorch] = useState(false);

  // 扫码确认卡：扫中后暂停继续识别，由用户确认数量后再加入
  const [pending, setPending] = useState<CachedSku | null>(null);
  const [pendingQty, setPendingQty] = useState(1);
  const [notFound, setNotFound] = useState<string | null>(null);
  // 手动输入条码（吊牌破损兜底）
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  // 议价/改价：正在编辑的购物车行
  const [priceEdit, setPriceEdit] = useState<CartLine | null>(null);
  const [priceValue, setPriceValue] = useState("");
  // 整单优惠：打折(zhe，如 8.8 折)或改价(total，优惠后总价分)
  const [discountKind, setDiscountKind] = useState<"none" | "zhe" | "total">(
    "none",
  );
  const [discountValue, setDiscountValue] = useState(0);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTab, setAdjustTab] = useState<"zhe" | "total">("zhe");
  const [adjustInput, setAdjustInput] = useState("");
  // 点击商品图放大查看
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  // 任一弹卡打开时暂停扫码（onBarcodeScanned 会高频触发）
  const sheetOpenRef = useRef(false);

  // 扫码成功提示音
  const beep = useAudioPlayer(require("../../assets/beep.wav"));
  function playBeep() {
    try {
      beep.seekTo(0);
      beep.play();
    } catch {
      // 忽略（部分环境不支持音频）
    }
  }

  function closeSheet() {
    setPending(null);
    setNotFound(null);
    setPendingQty(1);
    sheetOpenRef.current = false;
  }

  async function lookupAndPrompt(barcode: string) {
    const cached = await getCachedSkuByBarcode(barcode);
    if (!cached) {
      haptic("error");
      setNotFound(barcode);
      return;
    }
    playBeep();
    haptic("success");
    setPendingQty(1);
    setPending(cached);
  }

  async function handleScanned(e: ScanResult) {
    if (sheetOpenRef.current) return; // 已有弹卡，暂停识别
    sheetOpenRef.current = true; // 立即上锁，避免同一画面重复触发
    await lookupAndPrompt(e.data);
  }

  function submitManual() {
    const code = manualCode.trim();
    if (!code) return;
    setManualOpen(false);
    setManualCode("");
    sheetOpenRef.current = true; // 进入确认流程前上锁
    void lookupAndPrompt(code);
  }

  function openPriceEdit(line: CartLine) {
    setPriceEdit(line);
    setPriceValue((line.price / 100).toFixed(2));
  }

  function confirmPriceEdit() {
    if (!priceEdit) return;
    const n = Number(priceValue);
    if (!Number.isFinite(n) || n < 0) {
      Alert.alert("价格有误", "请输入有效的金额");
      return;
    }
    applyCart((prev) => setLinePrice(prev, priceEdit.skuId, Math.round(n * 100)));
    setPriceEdit(null);
  }

  /** 改动购物车内容/单价后，自动清除整单优惠（避免金额错乱，需重新设置） */
  function applyCart(next: (prev: CartLine[]) => CartLine[]) {
    setCart(next);
    if (discountKind !== "none") {
      setDiscountKind("none");
      setDiscountValue(0);
    }
  }

  function clearDiscount() {
    setDiscountKind("none");
    setDiscountValue(0);
  }

  function openAdjust() {
    if (cart.length === 0) return;
    setAdjustTab(discountKind === "total" ? "total" : "zhe");
    setAdjustInput(
      discountKind === "zhe"
        ? String(discountValue)
        : discountKind === "total"
          ? (discountValue / 100).toFixed(2)
          : "",
    );
    sheetOpenRef.current = true; // 暂停扫码
    setAdjustOpen(true);
  }

  function closeAdjust() {
    setAdjustOpen(false);
    setAdjustInput("");
    sheetOpenRef.current = false;
  }

  function confirmAdjust() {
    const orig = cartTotalCents(cart);
    const n = Number(adjustInput);
    if (adjustTab === "zhe") {
      if (!Number.isFinite(n) || n <= 0 || n >= 10) {
        Alert.alert("折扣有误", "请输入 0~10 之间的折扣，如 8.8（即 8.8 折）");
        return;
      }
      setDiscountKind("zhe");
      setDiscountValue(n);
    } else {
      const cents = Math.round(n * 100);
      if (!Number.isFinite(n) || n < 0) {
        Alert.alert("金额有误", "请输入有效的优惠后总价");
        return;
      }
      if (cents >= orig) {
        Alert.alert("无需改价", "优惠后总价需小于原价才会生效");
        return;
      }
      setDiscountKind("total");
      setDiscountValue(cents);
    }
    closeAdjust();
  }

  /** 当前购物车中该 SKU 已有数量 */
  function inCartQty(skuId: string): number {
    return cart.find((l) => l.skuId === skuId)?.quantity ?? 0;
  }

  function confirmAdd() {
    if (!pending) return;
    haptic("light");
    applyCart((prev) => addToCartQty(prev, toScannedSku(pending), pendingQty));
    setHint(`已加入：${pending.productName} ${pending.color}/${pending.size} ×${pendingQty}`);
    closeSheet();
  }

  function checkout() {
    if (cart.length === 0 || submitting) return;
    const orig = cartTotalCents(cart);
    const fin = computeFinalTotal(cart, discountKind, discountValue);
    const cnt = cartItemCount(cart);
    const priceLine =
      fin < orig
        ? `合计 ${yuan(fin)}（原价 ${yuan(orig)}${
            discountKind === "zhe" ? ` · ${discountValue}折` : " · 已改价"
          }）`
        : `合计 ${yuan(orig)}`;
    Alert.alert(
      "确认结算",
      `共 ${cnt} 件商品，${priceLine}\n确认收款并记录这笔销售？`,
      [
        { text: "再看看", style: "cancel" },
        { text: "确认结算", onPress: () => void doCheckout() },
      ],
    );
  }

  async function doCheckout() {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      const orig = cartTotalCents(cart);
      const fin = computeFinalTotal(cart, discountKind, discountValue);
      // 各行按原价入库；整单优惠作为订单级字段单独提交，避免整数分摊死角。
      // orderDiscountCents = 原价合计 - 实收（≥0；无优惠时为 0）
      const orderDiscountCents = Math.max(0, orig - fin);
      const input = cartToSaleInput(cart, genOpId(), orderDiscountCents);
      await enqueueSale(input);
      for (const line of cart) {
        await applyLocalStockDelta(line.skuId, -line.quantity);
      }
      setCart([]);
      clearDiscount();
      await refreshPending();
      void syncNow();
      Alert.alert(
        "已结算",
        online
          ? "销售已记录并正在同步到云端"
          : "当前离线，已记录在本地，联网后自动同步",
      );
      setHint("对准吊牌二维码扫描");
    } catch (e) {
      Alert.alert("结算失败", (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

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
        <Pressable onPress={onBack}>
          <Text style={styles.link}>返回</Text>
        </Pressable>
      </View>
    );
  }

  const total = cartTotalCents(cart);
  const count = cartItemCount(cart);
  const finalTotal = computeFinalTotal(cart, discountKind, discountValue);
  const discounted = finalTotal < total;
  const discountTag =
    discountKind === "zhe"
      ? `${discountValue}折`
      : discountKind === "total"
        ? "已改价"
        : "";

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack}>
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
        <Pressable onPress={() => setManualOpen(true)} hitSlop={8}>
          <Text style={styles.manualLink}>手动输入</Text>
        </Pressable>
      </View>

      <FlatList
        style={styles.cart}
        data={cart}
        keyExtractor={(l) => l.skuId}
        ListEmptyComponent={<Text style={styles.empty}>购物车为空，扫码添加商品</Text>}
        renderItem={({ item }) => (
          <View style={styles.line}>
            <Pressable style={styles.lineInfo} onPress={() => openPriceEdit(item)}>
              <Text style={styles.lineName}>{item.productName}</Text>
              <Text style={styles.lineMeta}>
                {item.color}/{item.size} · {yuan(item.price)}
                <Text style={styles.editPriceHint}>　改价›</Text>
              </Text>
            </Pressable>
            <View style={styles.stepper}>
              <Pressable
                style={styles.stepBtn}
                onPress={() =>
                  applyCart((prev) =>
                    setQuantity(prev, item.skuId, item.quantity - 1),
                  )
                }
              >
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Text style={styles.qty}>{item.quantity}</Text>
              <Pressable
                style={styles.stepBtn}
                onPress={() =>
                  applyCart((prev) =>
                    setQuantity(prev, item.skuId, item.quantity + 1),
                  )
                }
              >
                <Text style={styles.stepText}>＋</Text>
              </Pressable>
              <Pressable
                style={styles.removeBtn}
                onPress={() => applyCart((prev) => removeFromCart(prev, item.skuId))}
              >
                <Text style={styles.removeText}>删</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <View style={styles.totalLabelRow}>
            <Text style={styles.totalLabel}>合计（{count} 件）</Text>
            <Pressable onPress={openAdjust} disabled={cart.length === 0} hitSlop={6}>
              <Text
                style={[
                  styles.adjustLink,
                  cart.length === 0 && styles.adjustLinkDisabled,
                ]}
              >
                {discounted ? "修改优惠" : "优惠 / 改价"}
              </Text>
            </Pressable>
          </View>
          {discounted ? (
            <View style={styles.totalDiscRow}>
              <Text style={styles.total}>{yuan(finalTotal)}</Text>
              <Text style={styles.totalOrig}>{yuan(total)}</Text>
              <Text style={styles.discTag}>{discountTag}</Text>
            </View>
          ) : (
            <Text style={styles.total}>{yuan(total)}</Text>
          )}
        </View>
        <Pressable
          style={[styles.checkout, (cart.length === 0 || submitting) && styles.disabled]}
          disabled={cart.length === 0 || submitting}
          onPress={checkout}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.checkoutText}>结算</Text>
          )}
        </Pressable>
      </View>

      {/* 扫码确认卡 */}
      <Modal
        visible={pending !== null}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}
      >
        <Pressable style={styles.backdrop} onPress={closeSheet} />
        {pending ? (
          (() => {
            const already = inCartQty(pending.skuId);
            const maxAddable = Math.max(pending.stock - already, 0);
            const canAdd = maxAddable > 0;
            const qty = Math.min(pendingQty, Math.max(maxAddable, 1));
            return (
              <View style={styles.sheet}>
                <View style={styles.sheetHeader}>
                  <Pressable
                    style={styles.sheetCover}
                    onPress={() => {
                      const u = imageUrl(pending.coverImage);
                      if (u) setViewerUri(u);
                    }}
                  >
                    {pending.coverImage ? (
                      <Image
                        source={{ uri: thumbUrl(pending.coverImage) }}
                        style={styles.sheetCoverImg}
                      />
                    ) : (
                      <Text style={styles.coverPlaceholder}>无图</Text>
                    )}
                  </Pressable>
                  <View style={styles.sheetInfo}>
                    <Text style={styles.sheetName} numberOfLines={2}>
                      {pending.productName}
                    </Text>
                    <Text style={styles.sheetSpec}>
                      {pending.color}/{pending.size}
                    </Text>
                    <Text style={styles.sheetPrice}>{yuan(pending.salePrice)}</Text>
                  </View>
                </View>

                <View style={styles.sheetRow}>
                  <Text
                    style={[
                      styles.stockText,
                      pending.stock <= 3 && styles.stockLow,
                    ]}
                  >
                    库存 {pending.stock}
                    {already > 0 ? ` · 购物车已有 ${already} 件` : ""}
                  </Text>
                  <View style={styles.sheetStepper}>
                    <Pressable
                      style={[styles.stepBtnLg, qty <= 1 && styles.disabled]}
                      disabled={qty <= 1}
                      onPress={() => setPendingQty(Math.max(1, qty - 1))}
                    >
                      <Text style={styles.stepTextLg}>−</Text>
                    </Pressable>
                    <Text style={styles.sheetQty}>{canAdd ? qty : 0}</Text>
                    <Pressable
                      style={[
                        styles.stepBtnLg,
                        qty >= maxAddable && styles.disabled,
                      ]}
                      disabled={qty >= maxAddable}
                      onPress={() => setPendingQty(Math.min(maxAddable, qty + 1))}
                    >
                      <Text style={styles.stepTextLg}>＋</Text>
                    </Pressable>
                  </View>
                </View>

                {!canAdd ? (
                  <Text style={styles.warnText}>
                    购物车已达该商品库存上限
                  </Text>
                ) : null}

                <View style={styles.sheetActions}>
                  <Pressable style={styles.cancelBtn} onPress={closeSheet}>
                    <Text style={styles.cancelText}>取消</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.addBtn, !canAdd && styles.disabled]}
                    disabled={!canAdd}
                    onPress={confirmAdd}
                  >
                    <Text style={styles.addText}>
                      加入购物车 · {canAdd ? yuan(pending.salePrice * qty) : "—"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })()
        ) : null}
      </Modal>

      {/* 未找到条码提示卡 */}
      <Modal
        visible={notFound !== null}
        transparent
        animationType="fade"
        onRequestClose={closeSheet}
      >
        <Pressable style={styles.backdrop} onPress={closeSheet} />
        <View style={styles.notFoundSheet}>
          <Text style={styles.notFoundTitle}>未找到该条码</Text>
          <Text style={styles.notFoundCode}>{notFound}</Text>
          <Text style={styles.notFoundHint}>
            可能是别的店铺的吊牌，或商品尚未同步。请在有网时「立即同步」后重试。
          </Text>
          <Pressable style={styles.addBtn} onPress={closeSheet}>
            <Text style={styles.addText}>知道了</Text>
          </Pressable>
        </View>
      </Modal>

      {/* 手动输入条码（吊牌破损兜底） */}
      <Modal
        visible={manualOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setManualOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setManualOpen(false)}
        />
        <View style={styles.notFoundSheet}>
          <Text style={styles.notFoundTitle}>手动输入条码</Text>
          <TextInput
            style={styles.manualInput}
            placeholder="输入吊牌下方的数字编号"
            autoFocus
            keyboardType="number-pad"
            value={manualCode}
            onChangeText={setManualCode}
            onSubmitEditing={submitManual}
          />
          <View style={styles.sheetActions}>
            <Pressable
              style={styles.cancelBtn}
              onPress={() => setManualOpen(false)}
            >
              <Text style={styles.cancelText}>取消</Text>
            </Pressable>
            <Pressable
              style={[styles.addBtn, !manualCode.trim() && styles.disabled]}
              disabled={!manualCode.trim()}
              onPress={submitManual}
            >
              <Text style={styles.addText}>查找</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 议价/改价 */}
      <Modal
        visible={priceEdit !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPriceEdit(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPriceEdit(null)} />
        {priceEdit ? (
          <View style={styles.notFoundSheet}>
            <Text style={styles.notFoundTitle}>修改成交价</Text>
            <Text style={styles.notFoundCode}>
              {priceEdit.productName} {priceEdit.color}/{priceEdit.size}
            </Text>
            <View style={styles.priceInputRow}>
              <Text style={styles.priceYuan}>¥</Text>
              <TextInput
                style={styles.priceInput}
                placeholder="0.00"
                keyboardType="decimal-pad"
                autoFocus
                value={priceValue}
                onChangeText={setPriceValue}
                onSubmitEditing={confirmPriceEdit}
              />
            </View>
            <Text style={styles.notFoundHint}>每件成交单价，用于讨价还价/优惠。</Text>
            <View style={styles.sheetActions}>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => setPriceEdit(null)}
              >
                <Text style={styles.cancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.addBtn} onPress={confirmPriceEdit}>
                <Text style={styles.addText}>确定</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Modal>

      {/* 整单优惠：打折 / 改价 */}
      <Modal
        visible={adjustOpen}
        transparent
        animationType="fade"
        onRequestClose={closeAdjust}
      >
        <Pressable style={styles.backdrop} onPress={closeAdjust} />
        <View style={styles.notFoundSheet}>
          <Text style={styles.notFoundTitle}>整单优惠</Text>
          <View style={styles.adjustTabs}>
            <Pressable
              style={[styles.adjustTab, adjustTab === "zhe" && styles.adjustTabActive]}
              onPress={() => {
                setAdjustTab("zhe");
                setAdjustInput("");
              }}
            >
              <Text
                style={[
                  styles.adjustTabText,
                  adjustTab === "zhe" && styles.adjustTabTextActive,
                ]}
              >
                打折
              </Text>
            </Pressable>
            <Pressable
              style={[styles.adjustTab, adjustTab === "total" && styles.adjustTabActive]}
              onPress={() => {
                setAdjustTab("total");
                setAdjustInput("");
              }}
            >
              <Text
                style={[
                  styles.adjustTabText,
                  adjustTab === "total" && styles.adjustTabTextActive,
                ]}
              >
                改价
              </Text>
            </Pressable>
          </View>

          <View style={styles.priceInputRow}>
            <TextInput
              style={styles.priceInput}
              placeholder={adjustTab === "zhe" ? "8.8" : "0.00"}
              keyboardType="decimal-pad"
              autoFocus
              value={adjustInput}
              onChangeText={setAdjustInput}
              onSubmitEditing={confirmAdjust}
            />
            <Text style={styles.priceYuan}>{adjustTab === "zhe" ? "折" : "元"}</Text>
          </View>
          <Text style={styles.notFoundHint}>
            {adjustTab === "zhe"
              ? `输入几折，如 8.8 = 打 8.8 折（原价 ${yuan(total)}）`
              : `输入优惠后的总价，需小于原价 ${yuan(total)}`}
          </Text>

          <View style={styles.sheetActions}>
            {discounted ? (
              <Pressable
                style={styles.cancelBtn}
                onPress={() => {
                  clearDiscount();
                  closeAdjust();
                }}
              >
                <Text style={styles.cancelText}>清除优惠</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.cancelBtn} onPress={closeAdjust}>
                <Text style={styles.cancelText}>取消</Text>
              </Pressable>
            )}
            <Pressable style={styles.addBtn} onPress={confirmAdjust}>
              <Text style={styles.addText}>确定</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 18, fontWeight: "800", color: "#111" },
  link: { color: "#2563eb", fontSize: 16 },
  netDot: { fontSize: 13, fontWeight: "600" },
  online: { color: "#16a34a" },
  offline: { color: "#f59e0b" },
  cameraWrap: {
    height: 220,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: "hidden",
  },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    borderWidth: 3,
    borderColor: "#4ade80",
    borderRadius: 12,
  },
  torchBtn: {
    position: "absolute",
    bottom: 10,
    right: 10,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  torchOn: { backgroundColor: "rgba(245,158,11,0.85)" },
  torchText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingVertical: 8,
  },
  hint: { color: "#6b7280" },
  manualLink: { color: "#2563eb", fontSize: 14, fontWeight: "700" },
  editPriceHint: { color: "#2563eb", fontSize: 12 },
  manualInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 18,
    textAlign: "center",
  },
  priceInputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  priceYuan: { fontSize: 24, fontWeight: "800", color: "#111" },
  priceInput: {
    borderBottomWidth: 2,
    borderBottomColor: "#2563eb",
    minWidth: 140,
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
    paddingVertical: 4,
    color: "#111",
  },
  cart: { flex: 1, paddingHorizontal: 16 },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 24 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  lineInfo: { flex: 1 },
  lineName: { fontSize: 16, fontWeight: "600", color: "#111" },
  lineMeta: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#eef2ff",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 20, color: "#2563eb", fontWeight: "700" },
  qty: { minWidth: 28, textAlign: "center", fontSize: 16, fontWeight: "700" },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
  removeText: { color: "#dc2626", fontSize: 14 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  footerLeft: { flex: 1 },
  totalLabelRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  totalLabel: { fontSize: 13, color: "#6b7280" },
  adjustLink: { fontSize: 13, fontWeight: "700", color: "#2563eb" },
  adjustLinkDisabled: { color: "#cbd5e1" },
  totalDiscRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  totalOrig: {
    fontSize: 14,
    color: "#9ca3af",
    textDecorationLine: "line-through",
  },
  discTag: {
    fontSize: 12,
    fontWeight: "700",
    color: "#e11d48",
    backgroundColor: "#fee2e2",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: "hidden",
  },
  adjustTabs: {
    flexDirection: "row",
    gap: 8,
    alignSelf: "stretch",
    marginTop: 4,
  },
  adjustTab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
  },
  adjustTabActive: { backgroundColor: "#2563eb" },
  adjustTabText: { fontSize: 15, fontWeight: "700", color: "#475569" },
  adjustTabTextActive: { color: "#fff" },
  total: { fontSize: 24, fontWeight: "800", color: "#e11d48" },
  checkout: {
    backgroundColor: "#2563eb",
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
  },
  disabled: { opacity: 0.5 },
  checkoutText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  btn: {
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  tip: { fontSize: 16, color: "#333" },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 16,
  },
  sheetHeader: { flexDirection: "row", gap: 14 },
  sheetCover: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  sheetCoverImg: { width: "100%", height: "100%" },
  coverPlaceholder: { color: "#9ca3af", fontSize: 12 },
  sheetInfo: { flex: 1, justifyContent: "center", gap: 4 },
  sheetName: { fontSize: 18, fontWeight: "800", color: "#111" },
  sheetSpec: { fontSize: 14, color: "#6b7280" },
  sheetPrice: { fontSize: 20, fontWeight: "800", color: "#e11d48" },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stockText: { fontSize: 14, color: "#6b7280" },
  stockLow: { color: "#f59e0b", fontWeight: "700" },
  sheetStepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepBtnLg: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#eef2ff",
    alignItems: "center",
    justifyContent: "center",
  },
  stepTextLg: { fontSize: 26, color: "#2563eb", fontWeight: "800" },
  sheetQty: {
    minWidth: 40,
    textAlign: "center",
    fontSize: 22,
    fontWeight: "800",
    color: "#111",
  },
  warnText: { color: "#f59e0b", fontSize: 13, textAlign: "center" },
  sheetActions: { flexDirection: "row", gap: 12 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    alignItems: "center",
  },
  cancelText: { fontSize: 16, fontWeight: "700", color: "#6b7280" },
  addBtn: {
    flex: 2,
    backgroundColor: "#2563eb",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  addText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  notFoundSheet: {
    position: "absolute",
    left: 24,
    right: 24,
    top: "35%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    gap: 10,
    alignItems: "center",
  },
  notFoundTitle: { fontSize: 18, fontWeight: "800", color: "#dc2626" },
  notFoundCode: { fontSize: 14, color: "#374151", fontWeight: "600" },
  notFoundHint: {
    fontSize: 13,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 19,
  },
});
