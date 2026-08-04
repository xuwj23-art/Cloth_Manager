import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, font, radius, space, touch } from "../../theme/tokens";
import {
  selectCount,
  selectDiscounted,
  selectFinalCents,
  selectTotalCents,
  useCashierStore,
} from "./store";
import { yuan } from "./ui";

/**
 * 底部固定结算栏（UI-REFERENCES §2.4 Starbucks）。
 * 显示：件数 + 优惠后总价（大）+ 原价删除线（有优惠时）+ 「优惠/改价」入口 + 「结算」大按钮（墨绿，56dp）。
 * `onCheckout` / `onOpenDiscount` / `submitting` 由父组件提供。
 */
export function CheckoutBar({
  onCheckout,
  onOpenDiscount,
  submitting,
}: {
  onCheckout: () => void;
  onOpenDiscount: () => void;
  submitting: boolean;
}) {
  const cart = useCashierStore((s) => s.cart);
  const total = useCashierStore(selectTotalCents);
  const finalTotal = useCashierStore(selectFinalCents);
  const count = useCashierStore(selectCount);
  const discounted = useCashierStore(selectDiscounted);

  const empty = cart.length === 0;
  const disabled = empty || submitting;
  const tag = discounted ? "整单优惠" : "";

  return (
    <View style={styles.footer}>
      <View style={styles.left}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>合计（{count} 件）</Text>
          <Pressable onPress={onOpenDiscount} disabled={empty} hitSlop={6}>
            <Text style={[styles.adjustLink, empty && styles.adjustLinkDisabled]}>
              {discounted ? "修改优惠" : "优惠 / 改价"}
            </Text>
          </Pressable>
        </View>
        {discounted ? (
          <View style={styles.discRow}>
            <Text style={styles.total}>{yuan(finalTotal)}</Text>
            <Text style={styles.orig}>{yuan(total)}</Text>
            <Text style={styles.tag}>{tag}</Text>
          </View>
        ) : (
          <Text style={styles.total}>{yuan(total)}</Text>
        )}
      </View>

      <Pressable
        style={[styles.checkout, disabled && styles.disabled]}
        disabled={disabled}
        onPress={onCheckout}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.checkoutText}>结算 · {yuan(discounted ? finalTotal : total)}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    padding: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  left: { flex: 1 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  label: { fontSize: font.caption, color: colors.textMuted },
  adjustLink: {
    fontSize: font.caption,
    fontWeight: "700",
    color: colors.primary,
  },
  adjustLinkDisabled: { color: "#CBD5E1" },
  discRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  total: {
    fontSize: font.display - 8,
    fontWeight: "800",
    color: colors.primary,
  },
  orig: {
    fontSize: font.body,
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  tag: {
    fontSize: font.caption,
    fontWeight: "700",
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  checkout: {
    backgroundColor: colors.primary,
    height: touch.buttonHeight,
    paddingHorizontal: space.xxl + 8,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 140,
  },
  checkoutText: {
    color: "#fff",
    fontSize: font.body,
    fontWeight: "800",
  },
  disabled: { opacity: 0.5 },
});
