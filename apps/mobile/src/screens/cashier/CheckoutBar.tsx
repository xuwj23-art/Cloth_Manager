import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, space } from "../../theme/tokens";
import {
  selectCount,
  selectDiscounted,
  selectFinalCents,
  selectTotalCents,
  useCashierStore,
} from "./store";
import { yuan } from "./ui";

/**
 * 底部结算栏：三区布局（金额块 flex / 优惠图标钮 / 结算钮）。
 * - 优惠/改价入口用图标按钮替代裸文字链，不再与结算键在同一行抢宽度；
 * - 金额只在左侧展示一次，结算钮不重复总价，360dp 窄屏下稳定不折行。
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

  return (
    <View style={styles.footer}>
      {/* 左：金额块（全屏唯一金额展示位） */}
      <View style={styles.amount}>
        <View style={styles.priceRow}>
          <Text style={styles.total} numberOfLines={1} allowFontScaling={false}>
            {yuan(discounted ? finalTotal : total)}
          </Text>
          {discounted ? (
            <Text style={styles.orig} numberOfLines={1}>
              {yuan(total)}
            </Text>
          ) : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {count} 件{discounted ? ` · 已省 ${yuan(total - finalTotal)}` : ""}
        </Text>
      </View>

      {/* 中：整单优惠 / 改价（图标按钮；已设优惠时高亮红色提示） */}
      <Pressable
        style={[styles.discountBtn, discounted && styles.discountBtnOn, empty && styles.off]}
        disabled={empty}
        onPress={onOpenDiscount}
        accessibilityRole="button"
        accessibilityLabel={discounted ? "修改整单优惠" : "整单优惠或改价"}
        hitSlop={4}
      >
        <Ionicons
          name={discounted ? "pricetag" : "pricetag-outline"}
          size={22}
          color={discounted ? "#fff" : colors.primary}
        />
      </Pressable>

      {/* 右：结算（禁用=中性灰，不与品牌蓝混淆） */}
      <Pressable
        style={({ pressed }) => [
          styles.checkout,
          disabled ? styles.checkoutOff : pressed ? styles.checkoutPressed : null,
        ]}
        disabled={disabled}
        onPress={onCheckout}
        accessibilityRole="button"
        accessibilityLabel="结算"
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="card-outline" size={20} color={disabled ? "#9AA6B8" : "#fff"} />
            <Text style={[styles.checkoutText, disabled && styles.checkoutTextOff]}>结算</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    paddingVertical: space.md,
    paddingBottom: space.md + 4,
    paddingHorizontal: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  amount: { flex: 1, gap: 1, minWidth: 0 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  total: { fontSize: 26, fontWeight: "800", color: "#101E3C" },
  orig: {
    fontSize: font.caption,
    color: colors.textMuted,
    textDecorationLine: "line-through",
    flexShrink: 1,
  },
  meta: { fontSize: font.caption - 1, color: colors.textMuted },
  discountBtn: {
    width: 48,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  discountBtnOn: { backgroundColor: colors.danger },
  checkout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 52,
    paddingHorizontal: space.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
  },
  checkoutPressed: { backgroundColor: colors.primaryPressed },
  checkoutOff: { backgroundColor: "#E8EDF4" },
  checkoutText: { color: "#fff", fontSize: font.body, fontWeight: "800" },
  checkoutTextOff: { color: "#9AA6B8" },
  off: { opacity: 0.45 },
});
