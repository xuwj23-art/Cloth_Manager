import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font, radius, space, touch } from "../../theme/tokens";

export function PhotoSourceSheet({
  visible,
  label,
  onCamera,
  onLibrary,
  onClose,
}: {
  visible: boolean;
  label: string;
  onCamera: () => void;
  onLibrary: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={styles.title}>添加{label}图</Text>
          <Pressable style={styles.primary} onPress={onCamera}>
            <Text style={styles.primaryText}>拍照</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={onLibrary}>
            <Text style={styles.secondaryText}>从相册选</Text>
          </Pressable>
          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.xl,
    gap: space.sm,
  },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text, marginBottom: space.sm },
  primary: {
    height: touch.buttonHeight,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.sm,
  },
  primaryText: { color: "#fff", fontSize: font.body, fontWeight: "800" },
  secondary: {
    height: touch.buttonHeight,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: colors.primary, fontSize: font.body, fontWeight: "700" },
  cancel: {
    height: touch.minSize,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: colors.textMuted, fontSize: font.body, fontWeight: "600" },
});
