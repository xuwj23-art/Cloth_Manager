import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SaleOrderDetail } from "@cloth-scan/shared";
import { colors, font, motion, radius, space } from "../theme/tokens";
import { yuan } from "../utils/format";

/**
 * 「新结账」顶部滑入提醒卡（老板机前台提醒，替代旧的居中 AppDialog）。
 *
 * 设计：顶部安全区下滑入的白卡——金「吊牌」标签（带穿线孔小圆点，呼应服装吊牌业务）
 * + 金额大字 + 「N 件 · 操作人」副行；5 秒自动滑出，点击跳销售流水。
 * 不遮挡底部操作区、不打断当前操作（老板可能正在扫码）。
 */

interface SaleToastCtx {
  presentSale: (order: SaleOrderDetail) => void;
}

const SaleToastContext = createContext<SaleToastCtx | null>(null);

export function useSaleToast(): SaleToastCtx {
  const ctx = useContext(SaleToastContext);
  if (!ctx) throw new Error("useSaleToast 必须在 SaleToastProvider 内使用");
  return ctx;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function SaleToastProvider({
  children,
  onTapOrder,
}: {
  children: ReactNode;
  /** 点击卡片回调（由 App 传入：跳转销售流水） */
  onTapOrder?: () => void;
}) {
  const [order, setOrder] = useState<SaleOrderDetail | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTapRef = useRef(onTapOrder);
  onTapRef.current = onTapOrder;

  const hide = useCallback(() => {
    Animated.timing(anim, {
      toValue: 0,
      duration: motion.cardMs,
      useNativeDriver: true,
    }).start(() => setOrder(null));
  }, [anim]);

  const presentSale = useCallback(
    (o: SaleOrderDetail) => {
      setOrder(o);
      Animated.timing(anim, {
        toValue: 1,
        duration: motion.pageMs,
        useNativeDriver: true,
      }).start();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(hide, 5000);
    },
    [anim, hide],
  );

  const value = useMemo(() => ({ presentSale }), [presentSale]);

  function tap() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hide();
    onTapRef.current?.();
  }

  return (
    <SaleToastContext.Provider value={value}>
      {children}
      {order ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.overlay,
            {
              opacity: anim,
              transform: [
                {
                  translateY: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-28, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Pressable
            style={styles.card}
            onPress={tap}
            accessibilityRole="button"
            accessibilityLabel="新结账提醒，点击查看销售流水"
          >
            <View style={styles.topRow}>
              <View style={styles.tag}>
                <View style={styles.tagHole} />
                <Text style={styles.tagText}>新结账</Text>
              </View>
              <Text style={styles.time}>{formatClock(order.createdAt)}</Text>
            </View>
            <View style={styles.amountRow}>
              <View style={styles.amountLead}>
                <Ionicons name="checkmark-circle" size={20} color={colors.online} />
                <Text style={styles.amount}>{yuan(order.totalAmount)}</Text>
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {order.itemCount} 件{order.operatorName ? ` · ${order.operatorName}` : ""}
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
    </SaleToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    paddingTop: 22,
    zIndex: 999,
    elevation: 999,
  },
  card: {
    width: "88%",
    maxWidth: 400,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
    gap: space.sm,
    // 轻盈的浮起感：浅阴影，不压界面
    shadowColor: "#1A1A1A",
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  // 金吊牌标签：小圆点模拟价签穿线孔，是这张卡片的记忆点
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.gold,
    borderTopLeftRadius: 3,
    borderBottomLeftRadius: 3,
    borderTopRightRadius: radius.pill,
    borderBottomRightRadius: radius.pill,
    paddingLeft: 6,
    paddingRight: 10,
    paddingVertical: 3,
  },
  tagHole: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    borderWidth: 1,
    borderColor: "#F5F1E8",
  },
  tagText: { fontSize: 11, fontWeight: "800", color: "#3D2E14", letterSpacing: 1 },
  time: { fontSize: font.caption, color: colors.textMuted, fontWeight: "600" },
  amountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
  },
  amountLead: { flexDirection: "row", alignItems: "center", gap: 6 },
  amount: { fontSize: 28, fontWeight: "800", color: colors.primary, letterSpacing: -0.5 },
  meta: { fontSize: font.body, color: colors.textMuted, fontWeight: "600", flexShrink: 1 },
});
