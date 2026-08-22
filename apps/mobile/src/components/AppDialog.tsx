import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, font, radius, space, touch } from "../theme/tokens";

export function AppDialog({
  visible,
  title,
  message,
  confirmLabel = "确定",
  cancelLabel,
  destructive,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const showCancel = Boolean(cancelLabel);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.root} pointerEvents="box-none">
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.btns}>
            {showCancel ? (
              <Pressable style={styles.btnGhost} onPress={onCancel}>
                <Text style={styles.btnGhostText}>{cancelLabel}</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[
                styles.btnMain,
                destructive ? styles.btnDanger : styles.btnPrimary,
                !showCancel && styles.btnFull,
              ]}
              onPress={onConfirm}
            >
              <Text style={styles.btnMainText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    gap: space.md,
  },
  title: {
    fontSize: font.title,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  message: {
    fontSize: font.body,
    color: colors.textMuted,
    lineHeight: 24,
    textAlign: "center",
  },
  btns: {
    flexDirection: "row",
    gap: 10,
    marginTop: space.sm,
  },
  btnGhost: {
    flex: 1,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhostText: {
    color: colors.textMuted,
    fontSize: font.body,
    fontWeight: "700",
  },
  btnMain: {
    flex: 1,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  btnFull: { flex: 1 },
  btnPrimary: { backgroundColor: colors.primary },
  btnDanger: { backgroundColor: colors.danger },
  btnMainText: { color: "#fff", fontSize: font.body, fontWeight: "800" },
});
