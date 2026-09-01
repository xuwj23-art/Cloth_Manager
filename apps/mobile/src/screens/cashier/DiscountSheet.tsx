import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { cartTotalCents } from "@cloth-scan/shared";
import { colors, font, radius, space } from "../../theme/tokens";
import { selectDiscounted, selectTotalCents, useCashierStore } from "./store";
import { cashierStyles, yuan } from "./ui";

const fadeMs = 150;
type Tab = "zhe" | "total";

/**
 * 整单优惠/加价 Sheet（打折 zhe / 改价 total 两 tab）。
 *
 * 用订单级 orderDiscountCents 字段，不把差额摊到各行单价。
 * 各行 price 保持原价，差额 = 原价合计 − 目标总价，单独提交：
 * - 打折 tab：输入 9.5 = 9.5 折；输入 >10（如 12）= 上浮加价
 * - 改价 tab：输入目标总价（元），可高于原价合计（= 整单加价）
 * - 确定：setOrderDiscount(原价合计 − 目标总价)，可为负（负 = 加价）
 * - 清除：setOrderDiscount(0)
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
    if (orderDiscountCents !== 0) {
      // 反推：若已有优惠/加价，默认进 total tab，回填优惠后总价
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
      // 允许 >10 折（如 12 = 上浮 20%），只要为正
      if (!Number.isFinite(n) || n <= 0) {
        setError("折扣需大于 0");
        return;
      }
      const target = Math.round((orig * n) / 10);
      setOrderDiscount(orig - target);
    } else {
      // 目标总价可高于原价合计（差额为负 = 整单加价），但不得为负数
      if (!Number.isFinite(n) || n < 0) {
        setError("金额有误");
        return;
      }
      const cents = Math.round(n * 100);
      setOrderDiscount(orig - cents);
    }
    close();
  }

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={close}>
      <Pressable style={cashierStyles.backdrop} onPress={close} />
      {open ? (
        <Animated.View entering={FadeIn.duration(fadeMs)} style={cashierStyles.centerSheet}>
          <Text style={cashierStyles.titleText}>整单优惠 / 加价</Text>

          {/* tab 段控件 */}
          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, tab === "zhe" && styles.tabActive]}
              onPress={() => {
                setTab("zhe");
                setInput("");
                setError(null);
              }}
            >
              <View style={cashierStyles.iconRow}>
                <Ionicons
                  name="pricetags-outline"
                  size={15}
                  color={tab === "zhe" ? "#fff" : "#475569"}
                />
                <Text style={[styles.tabText, tab === "zhe" && styles.tabTextActive]}>打折</Text>
              </View>
            </Pressable>
            <Pressable
              style={[styles.tab, tab === "total" && styles.tabActive]}
              onPress={() => {
                setTab("total");
                setInput("");
                setError(null);
              }}
            >
              <View style={cashierStyles.iconRow}>
                <Ionicons
                  name="create-outline"
                  size={15}
                  color={tab === "total" ? "#fff" : "#475569"}
                />
                <Text style={[styles.tabText, tab === "total" && styles.tabTextActive]}>改价</Text>
              </View>
            </Pressable>
          </View>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder={tab === "zhe" ? "9.5" : "0.00"}
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
          <Text style={cashierStyles.hint}>原价合计 {yuan(orig)}</Text>
          {error ? <Text style={styles.err}>{error}</Text> : null}

          <View style={styles.actions}>
            {hasDiscount ? (
              <Pressable style={styles.clearBtn} onPress={clearDiscount}>
                <View style={cashierStyles.iconRow}>
                  <Ionicons name="refresh" size={17} color={colors.danger} />
                  <Text style={styles.clearText}>清除</Text>
                </View>
              </Pressable>
            ) : (
              <Pressable style={cashierStyles.secondaryBtn} onPress={close}>
                <View style={cashierStyles.iconRow}>
                  <Ionicons name="close" size={17} color={colors.textMuted} />
                  <Text style={cashierStyles.secondaryBtnText}>取消</Text>
                </View>
              </Pressable>
            )}
            <Pressable style={[cashierStyles.primaryBtn, styles.confirmBtn]} onPress={confirm}>
              <View style={cashierStyles.iconRow}>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={cashierStyles.primaryBtnText}>确定</Text>
              </View>
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
    gap: 4,
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
