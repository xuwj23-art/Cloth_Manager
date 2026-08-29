import { Modal, Pressable, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { font, space } from "../../theme/tokens";
import { useCashierStore } from "./store";
import { cashierStyles } from "./ui";

const fadeMs = 150;

/**
 * 未找到条码提示卡：居中淡入，展示条码 + 重新扫码按钮。
 */
export function NotFoundSheet() {
  const barcode = useCashierStore((s) => s.notFoundBarcode);
  const closeSheet = useCashierStore((s) => s.closeSheet);
  const visible = barcode !== null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={closeSheet}>
      <Pressable style={cashierStyles.backdrop} onPress={closeSheet} />
      {visible ? (
        <Animated.View entering={FadeIn.duration(fadeMs)} style={cashierStyles.centerSheet}>
          <Text style={styles.title}>未找到该条码</Text>
          <Text style={styles.code}>{barcode}</Text>
          <Text style={cashierStyles.hint}>
            可能是别的店铺的吊牌，或商品尚未同步。请在有网时「立即同步」后重试。
          </Text>
          <View style={{ height: space.sm }} />
          <Pressable
            style={[cashierStyles.primaryBtn, { alignSelf: "stretch" }]}
            onPress={closeSheet}
          >
            <View style={cashierStyles.iconRow}>
              <Ionicons name="scan-outline" size={18} color="#fff" />
              <Text style={cashierStyles.primaryBtnText}>知道了，重新扫码</Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

const styles = {
  title: {
    fontSize: font.title,
    fontWeight: "800" as const,
    color: "#DC2626",
  },
  code: { fontSize: font.body, color: "#374151", fontWeight: "600" as const },
};
