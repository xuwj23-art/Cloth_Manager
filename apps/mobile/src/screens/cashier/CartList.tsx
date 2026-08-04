import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import Animated, { FadeIn } from "react-native-reanimated";
import type { CartLine } from "@cloth-scan/shared";
import { colors, font, radius, space, touch } from "../../theme/tokens";
import { useCashierStore } from "./store";
import { cashierStyles, yuan } from "./ui";

const staggerMs = 30; // motion.staggerMs

/**
 * 购物车列表（@shopify/flash-list，性能优于 FlatList）。
 * 每行：图 + 名 + 规格 + 价 + 数量步进器（-/+ 大按钮 ≥48dp）+ 删除。
 * 点击行（非步进器区域）打开改价 Sheet。
 * 列表项 stagger 淡入（30ms 错位，§3.4）。
 */
export function CartList() {
  const cart = useCashierStore((s) => s.cart);
  const setQty = useCashierStore((s) => s.setQty);
  const removeLine = useCashierStore((s) => s.removeLine);
  const startEditPrice = useCashierStore((s) => s.startEditPrice);

  if (cart.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>购物车为空，扫码添加商品</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlashList
        data={cart}
        keyExtractor={(item: CartLine) => item.skuId}
        renderItem={({ item, index }) => (
          <CartRow
            line={item}
            index={index}
            onInc={() => setQty(item.skuId, item.quantity + 1)}
            onDec={() => setQty(item.skuId, item.quantity - 1)}
            onRemove={() => removeLine(item.skuId)}
            onEdit={() => startEditPrice(item.skuId)}
          />
        )}
      />
    </View>
  );
}

interface CartRowProps {
  line: CartLine;
  index: number;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
  onEdit: () => void;
}

const CartRowBase = ({ line, index, onInc, onDec, onRemove, onEdit }: CartRowProps) => (
  <Animated.View entering={FadeIn.delay(index * staggerMs).duration(150)} style={styles.row}>
    {/* 缩略图占位：CartLine 不带封面图，用品名首字占位（墨绿浅底） */}
    <View style={styles.thumb}>
      <Text style={styles.thumbText}>{line.productName.slice(0, 1)}</Text>
    </View>

    <Pressable style={styles.info} onPress={onEdit}>
      <Text style={styles.name} numberOfLines={1}>
        {line.productName}
      </Text>
      <Text style={styles.meta}>
        {line.color}/{line.size} · {yuan(line.price)}
        <Text style={styles.editHint}> 改价</Text>
      </Text>
    </Pressable>

    <View style={styles.stepper}>
      <Pressable
        style={[
          cashierStyles.stepperBtn,
          styles.stepSm,
          line.quantity <= 1 && cashierStyles.disabled,
        ]}
        disabled={line.quantity <= 1}
        onPress={onDec}
      >
        <Text style={cashierStyles.stepperText}>−</Text>
      </Pressable>
      <Text style={styles.qty}>{line.quantity}</Text>
      <Pressable style={[cashierStyles.stepperBtn, styles.stepSm]} onPress={onInc}>
        <Text style={cashierStyles.stepperText}>＋</Text>
      </Pressable>
      <Pressable style={styles.removeBtn} onPress={onRemove}>
        <Text style={styles.removeText}>删</Text>
      </Pressable>
    </View>
  </Animated.View>
);

const CartRow = memo(CartRowBase);

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: space.lg },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { textAlign: "center", color: colors.textMuted, fontSize: font.body },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: space.md,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbText: {
    fontSize: font.title,
    fontWeight: "800",
    color: colors.primary,
  },
  info: { flex: 1 },
  name: { fontSize: font.body, fontWeight: "600", color: colors.text },
  meta: { fontSize: font.caption, color: colors.textMuted, marginTop: 2 },
  editHint: { color: colors.primary, fontSize: font.caption },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.xs },
  stepSm: { width: touch.minSize, height: touch.minSize },
  qty: { minWidth: 28, textAlign: "center", fontSize: font.body, fontWeight: "700" },
  removeBtn: {
    width: touch.minSize,
    height: touch.minSize,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: space.xs,
  },
  removeText: { color: colors.danger, fontSize: font.body },
});
