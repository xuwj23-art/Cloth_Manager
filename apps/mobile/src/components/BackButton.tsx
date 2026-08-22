import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, touch } from "../theme/tokens";

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={styles.btn}
      accessibilityRole="button"
      accessibilityLabel="返回"
    >
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: touch.minSize,
    height: touch.minSize,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -8,
  },
});
