import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { colors, radius, space } from "../../theme/tokens";
import { useCashierStore } from "./store";
import { cashierStyles } from "./ui";

const fadeMs = 150;

/**
 * 手动输入条码（吊牌破损兜底）。
 * 用大号回显 + 系统 number-pad，输完点「查找」走与扫码一致的查找流程。
 * `onSubmitBarcode` 由父组件提供（封装 catalog 查找 + 提示音 + 触感）。
 */
export function ManualInputSheet({
  onSubmitBarcode,
}: {
  onSubmitBarcode: (barcode: string) => void;
}) {
  const open = useCashierStore((s) => s.activeSheet === "manual");
  const setSheet = useCashierStore((s) => s.setSheet);
  const [code, setCode] = useState("");

  // 关闭时复位
  useEffect(() => {
    if (!open) setCode("");
  }, [open]);

  function submit() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setSheet("none");
    onSubmitBarcode(trimmed);
  }

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={() => setSheet("none")}>
      <Pressable style={cashierStyles.backdrop} onPress={() => setSheet("none")} />
      {open ? (
        <Animated.View entering={FadeIn.duration(fadeMs)} style={cashierStyles.bottomSheet}>
          <Text style={cashierStyles.titleText}>手动输入条码</Text>
          <Text style={cashierStyles.captionText}>输入吊牌下方的数字编号</Text>

          <TextInput
            style={styles.display}
            placeholder="输入条码数字"
            placeholderTextColor={colors.textMuted}
            autoFocus
            keyboardType="number-pad"
            value={code}
            onChangeText={setCode}
            onSubmitEditing={submit}
          />

          <View style={styles.actions}>
            <Pressable style={cashierStyles.secondaryBtn} onPress={() => setSheet("none")}>
              <Text style={cashierStyles.secondaryBtnText}>取消</Text>
            </Pressable>
            <Pressable
              style={[
                cashierStyles.primaryBtn,
                styles.findBtn,
                !code.trim() && cashierStyles.disabled,
              ]}
              disabled={!code.trim()}
              onPress={submit}
            >
              <Text style={cashierStyles.primaryBtnText}>查找</Text>
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  display: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    color: colors.text,
  },
  actions: { flexDirection: "row", gap: space.md },
  findBtn: { flex: 2 },
});
