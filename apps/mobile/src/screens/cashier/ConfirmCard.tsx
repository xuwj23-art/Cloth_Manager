import { useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { memberPriceToTagPrice } from "@cloth-scan/shared";
import { colors, font, radius, space } from "../../theme/tokens";
import { imageUrl, thumbUrl } from "../../api";
import { ImageViewer } from "../../components/ImageViewer";
import { useCashierStore } from "./store";
import { cashierStyles, yuan } from "./ui";

const fadeMs = 200; // motion.cardMs

/**
 * 扫码确认卡：大商品图 + 规格 + 价 + 库存 + 数量步进器 + 加入购物车。
 * 价格展示双档：原价（会员价÷0.7）+ 会员价（salePrice 实价，标注 7 折）。
 * 会员态：会员价金色大字、原价划线、加入按会员价；非会员态反之。
 * 入场：纯淡入（无位移/无弹簧，避免"弹"的观感过重）。
 */
export function ConfirmCard() {
  const pendingSku = useCashierStore((s) => s.pendingSku);
  const pendingQty = useCashierStore((s) => s.pendingQty);
  const cart = useCashierStore((s) => s.cart);
  const isMember = useCashierStore((s) => s.isMember);
  const setPendingQty = useCashierStore((s) => s.setPendingQty);
  const confirmAdd = useCashierStore((s) => s.confirmAdd);
  const closeSheet = useCashierStore((s) => s.closeSheet);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const visible = pendingSku !== null;
  if (!visible || !pendingSku) return null;

  const sku = pendingSku;
  const memberPrice = sku.salePrice; // 会员价 = 实价
  const tagPrice = memberPriceToTagPrice(memberPrice); // 原价 = 会员价 ÷ 0.7
  const basePrice = isMember ? memberPrice : tagPrice; // 当前态进车价
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
      <Animated.View entering={FadeIn.duration(fadeMs)} style={cashierStyles.bottomSheet}>
        {/* 头部：大封面 + 品名 + 规格 + 双价 */}
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
            {isMember ? (
              <View style={styles.priceRow}>
                <Text style={[styles.price, styles.priceGold]}>{yuan(memberPrice)}</Text>
                <Text style={styles.priceTag}>会员价</Text>
                <Text style={styles.priceStrike}>{yuan(tagPrice)}</Text>
              </View>
            ) : (
              <View style={styles.priceRow}>
                <Text style={styles.price}>{yuan(tagPrice)}</Text>
                <Text style={styles.priceTagGold}>会员 {yuan(memberPrice)}</Text>
              </View>
            )}
          </View>
        </View>

        {/* 库存 + 数量步进器 */}
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
              accessibilityRole="button"
              accessibilityLabel="减少数量"
            >
              <Ionicons name="remove" size={26} color={colors.primary} />
            </Pressable>
            <Text style={styles.qty}>{canAdd ? qty : 0}</Text>
            <Pressable
              style={[cashierStyles.stepperBtn, qty >= maxAddable && cashierStyles.disabled]}
              disabled={qty >= maxAddable}
              onPress={() => setPendingQty(Math.min(maxAddable, qty + 1))}
              accessibilityRole="button"
              accessibilityLabel="增加数量"
            >
              <Ionicons name="add" size={26} color={colors.primary} />
            </Pressable>
          </View>
        </View>

        {!canAdd ? <Text style={styles.warn}>购物车已达该商品库存上限</Text> : null}

        {/* 动作栏：取消 + 加入大按钮 */}
        <View style={styles.actions}>
          <Pressable style={cashierStyles.secondaryBtn} onPress={close}>
            <View style={cashierStyles.iconRow}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
              <Text style={cashierStyles.secondaryBtnText}>取消</Text>
            </View>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              cashierStyles.primaryBtn,
              styles.addBtn,
              pressed && cashierStyles.primaryBtnPressed,
              !canAdd && cashierStyles.disabled,
            ]}
            disabled={!canAdd}
            onPress={confirmAdd}
          >
            <View style={cashierStyles.iconRow}>
              <Ionicons name="cart-outline" size={18} color="#fff" />
              <Text style={cashierStyles.primaryBtnText} numberOfLines={1}>
                加入 · {canAdd ? yuan(basePrice * qty) : "—"}
              </Text>
            </View>
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
  /** 价格行内各元素垂直居中（大价与小标对齐，避免小字贴底） */
  priceRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  price: {
    fontSize: font.title + 2,
    fontWeight: "800",
    color: colors.primary,
  },
  /** 会员态大字金色 */
  priceGold: { color: colors.gold },
  /** 会员态「会员价 · 7折」金色小标 / 原价划线 */
  priceTag: { fontSize: font.caption, fontWeight: "800", color: colors.gold },
  priceStrike: {
    fontSize: font.caption,
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  /** 非会员态金色会员价提示（推销话术：扫一眼看到 7 折） */
  priceTagGold: { fontSize: font.caption, fontWeight: "700", color: colors.gold },
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
