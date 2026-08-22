import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { colors, font, touch } from "../theme/tokens";

export function SyncAction({
  syncing,
  online,
  pendingCount,
  onPress,
}: {
  syncing: boolean;
  online: boolean;
  pendingCount: number;
  onPress: () => void;
}) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (syncing) {
      rotation.value = withRepeat(
        withTiming(rotation.value + 360, { duration: 900, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(rotation);
    }
  }, [syncing, rotation]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const status = syncing
    ? "同步中"
    : !online
      ? "离线"
      : pendingCount > 0
        ? `${pendingCount} 笔待同步`
        : "已同步";
  const iconColor = !online ? colors.warn : colors.primary;

  function handlePress() {
    if (!syncing) {
      rotation.value = withTiming(rotation.value + 360, {
        duration: 700,
        easing: Easing.out(Easing.cubic),
      });
    }
    onPress();
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{status}</Text>
      <Pressable
        onPress={handlePress}
        disabled={syncing}
        hitSlop={8}
        style={styles.hit}
        accessibilityRole="button"
        accessibilityLabel="同步"
      >
        <Animated.View style={spinStyle}>
          <Ionicons name="sync-outline" size={16} color={iconColor} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: touch.minSize,
    marginTop: 4,
  },
  hit: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: font.body,
    color: colors.textMuted,
    fontWeight: "600",
  },
});
