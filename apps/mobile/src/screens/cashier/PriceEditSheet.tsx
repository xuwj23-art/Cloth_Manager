import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { colors, font, space } from "../../theme/tokens";
import { useCashierStore } from "./store";
import { cashierStyles, yuan } from "./ui";

const fadeMs = 150;

/**
 * 议价/改价 Sheet：修改某行的成交单价（每件）。
 * 读 editingSkuId 找到目标行，输入新单价（元），确定后调 editPrice（清整单优惠）。
 */
export function PriceEditSheet() {
  const open = useCashierStore((s) => s.activeSheet === "priceEdit");
  const editingSkuId = useCashierStore((s) => s.editingSkuId);
  const cart = useCashierStore((s) => s.cart);
  const editPrice = useCashierStore((s) => s.editPrice);
  const setSheet = useCashierStore((s) => s.setSheet);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const line = editingSkuId ? (cart.find((l) => l.skuId === editingSkuId) ?? null) : null;

  // 打开或切换目标行时回填当前价（元）。仅依赖 open/行 id，避免改价过程中被 value 变化打断。
  useEffect(() => {
    if (open && line) {
      setValue((line.price / 100).toFixed(2));
      setError(null);
    }
  }, [open, line?.skuId]);

  function close() {
    setSheet("none");
  }

  function confirm() {
    if (!line) return;
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n) || n < 0) {
      setError("价格有误");
      return;
    }
    editPrice(line.skuId, Math.round(n * 100));
  }

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={close}>
      <Pressable style={cashierStyles.backdrop} onPress={close} />
      {open && line ? (
        <Animated.View entering={FadeIn.duration(fadeMs)} style={cashierStyles.centerSheet}>
          <Text style={cashierStyles.titleText}>修改成交价</Text>
          <Text style={styles.meta}>
            {line.productName} {line.color}/{line.size}
          </Text>

          <View style={styles.inputRow}>
            <Text style={styles.yuan}>¥</Text>
            <TextInput
              style={styles.input}
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              autoFocus
              value={value}
              onChangeText={(t) => {
                setError(null);
                setValue(t);
              }}
              onSubmitEditing={confirm}
            />
          </View>
          <Text style={cashierStyles.hint}>当前 {yuan(line.price)} / 件</Text>
          {error ? <Text style={styles.err}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable style={cashierStyles.secondaryBtn} onPress={close}>
              <Text style={cashierStyles.secondaryBtnText}>取消</Text>
            </Pressable>
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
  meta: { fontSize: font.body, color: colors.textMuted, fontWeight: "600" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  yuan: { fontSize: font.display - 8, fontWeight: "800", color: colors.text },
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
  actions: { flexDirection: "row", gap: space.md },
  confirmBtn: { flex: 2 },
  err: { fontSize: font.caption, color: colors.danger, fontWeight: "700", textAlign: "center" },
});
