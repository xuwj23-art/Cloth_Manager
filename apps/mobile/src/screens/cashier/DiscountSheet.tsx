import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { cartTotalCents } from "@cloth-scan/shared";
import { colors, font, radius, space } from "../../theme/tokens";
import { selectDiscounted, selectTotalCents, useCashierStore } from "./store";
import { cashierStyles, yuan } from "./ui";

const fadeMs = 150;
type Tab = "zhe" | "total";

/**
 * 整单优惠 Sheet（打折 zhe / 改价 total 两 tab）。
 *
 * 第 2 波 Task 4：改用订单级 orderDiscountCents 字段，不再调 distributeOrderTotal
 * 把优惠摊到各行单价。各行 price 保持原价，优惠 = 原价合计 − 目标总价，单独提交。
 *
 * - 打折 tab：输入 8.8 = 8.8 折 → 目标总价 = round(orig * value / 10)
 * - 改价 tab：输入优惠后总价（元）→ 目标总价 = round(value * 100)
 * - 确定：setOrderDiscount(max(0, orig − 目标总价))
 * - 清除优惠：setOrderDiscount(0)
 */
export function DiscountSheet() {
  const open = useCashierStore((s) => s.activeSheet === "discount");
  const cart = useCashierStore((s) => s.cart);
  const orderDiscountCents = useCashierStore((s) => s.orderDiscountCents);
  const setOrderDiscount = useCashierStore((s) => s.setOrderDiscount);
  const setSheet = useCashierStore((s) => s.setSheet);
  const totalCents = useCashierStore(selectTotalCents);
  const hasDiscount = useCashierStore(selectDiscounted);

  const [tab, setTab] = useState<Tab>("zhe");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const orig = totalCents || cartTotalCents(cart);

  // 打开时按当前已有优惠模式预填（仅响应 open 切换；故意不依赖 orig/orderDiscountCents
  // 以免每次改车后预填被反复覆盖）
  useEffect(() => {
    if (!open) return;
    if (orderDiscountCents > 0) {
      // 反推：若有优惠，默认进 total tab，回填优惠后总价
      setTab("total");
      setInput(((orig - orderDiscountCents) / 100).toFixed(2));
    } else {
      setTab("zhe");
      setInput("");
    }
  }, [open]);

  function close() {
    setSheet("none");
    setInput("");
    setError(null);
  }

  function clearDiscount() {
    setOrderDiscount(0);
    close();
  }

  function confirm() {
    const n = Number(input);
    if (tab === "zhe") {
      if (!Number.isFinite(n) || n <= 0 || n >= 10) {
        setError("折扣需在 0～10 之间");
        return;
      }
      const target = Math.min(orig, Math.round((orig * n) / 10));
      setOrderDiscount(Math.max(0, orig - target));
    } else {
      if (!Number.isFinite(n) || n < 0) {
        setError("金额有误");
        return;
      }
      const cents = Math.round(n * 100);
      if (cents >= orig) {
        setError("需低于原价");
        return;
      }
      setOrderDiscount(Math.max(0, orig - cents));
    }
    close();
  }

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={close}>
      <Pressable style={cashierStyles.backdrop} onPress={close} />
      {open ? (
        <Animated.View entering={FadeIn.duration(fadeMs)} style={cashierStyles.centerSheet}>
          <Text style={cashierStyles.titleText}>整单优惠</Text>

          {/* tab 段控件（大段，§2.5） */}
          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, tab === "zhe" && styles.tabActive]}
              onPress={() => {
                setTab("zhe");
                setInput("");
                setError(null);
              }}
            >
              <Text style={[styles.tabText, tab === "zhe" && styles.tabTextActive]}>打折</Text>
            </Pressable>
            <Pressable
              style={[styles.tab, tab === "total" && styles.tabActive]}
              onPress={() => {
                setTab("total");
                setInput("");
                setError(null);
              }}
            >
              <Text style={[styles.tabText, tab === "total" && styles.tabTextActive]}>改价</Text>
            </Pressable>
          </View>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder={tab === "zhe" ? "8.8" : "0.00"}
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              autoFocus
              value={input}
              onChangeText={(t) => {
                setError(null);
                setInput(t);
              }}
              onSubmitEditing={confirm}
            />
            <Text style={styles.unit}>{tab === "zhe" ? "折" : "元"}</Text>
          </View>
          <Text style={cashierStyles.hint}>原价 {yuan(orig)}</Text>
          {error ? <Text style={styles.err}>{error}</Text> : null}

          <View style={styles.actions}>
            {hasDiscount ? (
              <Pressable style={styles.clearBtn} onPress={clearDiscount}>
                <Text style={styles.clearText}>清除优惠</Text>
              </Pressable>
            ) : (
              <Pressable style={cashierStyles.secondaryBtn} onPress={close}>
                <Text style={cashierStyles.secondaryBtnText}>取消</Text>
              </Pressable>
            )}
            <Pressable style={[cashierStyles.primaryBtn, styles.confirmBtn]} onPress={confirm}>
              <Text style={cashierStyles.primaryBtnText}>确定</Text>
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: space.sm },
  tab: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: font.body, fontWeight: "700", color: "#475569" },
  tabTextActive: { color: "#fff" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  input: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    minWidth: 160,
    fontSize: font.display - 4,
    fontWeight: "800",
    textAlign: "center",
    paddingVertical: space.xs,
    color: colors.text,
  },
  unit: { fontSize: font.display - 8, fontWeight: "800", color: colors.text },
  err: { fontSize: font.caption, color: colors.danger, fontWeight: "700", textAlign: "center" },
  actions: { flexDirection: "row", gap: space.md },
  clearBtn: {
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  clearText: { fontSize: font.body, fontWeight: "700", color: colors.danger },
  confirmBtn: { flex: 2 },
});
