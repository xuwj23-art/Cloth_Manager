import { useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { colors, font, radius, space } from "../../theme/tokens";
import { imageUrl, thumbUrl } from "../../api";
import { ImageViewer } from "../../components/ImageViewer";
import { useCashierStore } from "./store";
import { cashierStyles, yuan } from "./ui";

const slideMs = 150; // motion.cardMs

/**
 * 扫码确认卡（UI-REFERENCES §2.4 Starbucks）。
 * 扫中后弹出：大商品图 + 规格 + 价 + 库存 + 数量步进器（-/+ 大按钮 56dp）+ "加入购物车"大按钮。
 * 入场：Reanimated slide-up + fade（150ms）。
 */
export function ConfirmCard() {
  const pendingSku = useCashierStore((s) => s.pendingSku);
  const pendingQty = useCashierStore((s) => s.pendingQty);
  const cart = useCashierStore((s) => s.cart);
  const setPendingQty = useCashierStore((s) => s.setPendingQty);
  const confirmAdd = useCashierStore((s) => s.confirmAdd);
  const closeSheet = useCashierStore((s) => s.closeSheet);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const visible = pendingSku !== null;
  if (!visible || !pendingSku) return null;

  const sku = pendingSku;
  const already = cart.find((l) => l.skuId === sku.skuId)?.quantity ?? 0;
  const maxAddable = Math.max(sku.stock - already, 0);
  const canAdd = maxAddable > 0;
  // 夹紧当前数量到 [1, maxAddable]（防 pendingQty 越界）
  const qty = canAdd ? Math.min(Math.max(pendingQty, 1), maxAddable) : 0;

  function close() {
    setViewerUri(null);
    closeSheet();
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <Pressable style={cashierStyles.backdrop} onPress={close} />
      <Animated.View
        entering={FadeInDown.duration(slideMs).springify().damping(20)}
        style={cashierStyles.bottomSheet}
      >
        {/* 头部：大封面 + 品名 + 规格 + 价 */}
        <View style={styles.header}>
          <Pressable
            style={styles.cover}
            onPress={() => {
              const u = imageUrl(sku.coverImage);
              if (u) setViewerUri(u);
            }}
          >
            {sku.coverImage ? (
              <Image source={{ uri: thumbUrl(sku.coverImage) }} style={styles.coverImg} />
            ) : (
              <Text style={styles.coverPlaceholder}>无图</Text>
            )}
          </Pressable>
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={2}>
              {sku.productName}
            </Text>
            <Text style={styles.spec}>
              {sku.color}/{sku.size}
            </Text>
            <Text style={styles.price}>{yuan(sku.salePrice)}</Text>
          </View>
        </View>

        {/* 库存 + 数量步进器（Starbucks 式大按钮） */}
        <View style={styles.row}>
          <Text style={[styles.stock, sku.stock <= 3 && styles.stockLow]}>
            库存 {sku.stock}
            {already > 0 ? ` · 购物车已有 ${already} 件` : ""}
          </Text>
          <View style={styles.stepper}>
            <Pressable
              style={[cashierStyles.stepperBtn, qty <= 1 && cashierStyles.disabled]}
              disabled={qty <= 1}
              onPress={() => setPendingQty(Math.max(1, qty - 1))}
            >
              <Text style={cashierStyles.stepperText}>−</Text>
            </Pressable>
            <Text style={styles.qty}>{canAdd ? qty : 0}</Text>
            <Pressable
              style={[cashierStyles.stepperBtn, qty >= maxAddable && cashierStyles.disabled]}
              disabled={qty >= maxAddable}
              onPress={() => setPendingQty(Math.min(maxAddable, qty + 1))}
            >
              <Text style={cashierStyles.stepperText}>＋</Text>
            </Pressable>
          </View>
        </View>

        {!canAdd ? <Text style={styles.warn}>购物车已达该商品库存上限</Text> : null}

        {/* 动作栏：取消 + 加入大按钮 */}
        <View style={styles.actions}>
          <Pressable style={cashierStyles.secondaryBtn} onPress={close}>
            <Text style={cashierStyles.secondaryBtnText}>取消</Text>
          </Pressable>
          <Pressable
            style={[cashierStyles.primaryBtn, styles.addBtn, !canAdd && cashierStyles.disabled]}
            disabled={!canAdd}
            onPress={confirmAdd}
          >
            <Text style={cashierStyles.primaryBtnText}>
              加入购物车 · {canAdd ? yuan(sku.salePrice * qty) : "—"}
            </Text>
          </Pressable>
        </View>
      </Animated.View>

      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: space.lg },
  cover: {
    width: 88,
    height: 88,
    borderRadius: radius.md,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coverImg: { width: "100%", height: "100%" },
  coverPlaceholder: { color: colors.textMuted, fontSize: font.caption },
  info: { flex: 1, justifyContent: "center", gap: space.xs },
  name: { fontSize: font.title, fontWeight: "800", color: colors.text },
  spec: { fontSize: font.body, color: colors.textMuted },
  price: {
    fontSize: font.title + 2,
    fontWeight: "800",
    color: colors.primary,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stock: { fontSize: font.body, color: colors.textMuted },
  stockLow: { color: colors.warn, fontWeight: "700" },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.md },
  qty: {
    minWidth: 44,
    textAlign: "center",
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
  },
  warn: { color: colors.warn, fontSize: font.body, textAlign: "center" },
  actions: { flexDirection: "row", gap: space.md },
  addBtn: { flex: 2 },
});
