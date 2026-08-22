import { Image, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily } from "../theme/tokens";

const mark = require("../../assets/logo_mark.png");
const lockup = require("../../assets/logo_lockup.png");

export function BrandLockup({ variant = "header" }: { variant?: "header" | "login" }) {
  if (variant === "login") {
    return (
      <View style={styles.loginWrap}>
        <Image source={lockup} style={styles.lockup} resizeMode="contain" />
        <Text style={styles.loginTitle}>收银台</Text>
      </View>
    );
  }
  return (
    <View style={styles.headerWrap}>
      <Image source={mark} style={styles.mark} resizeMode="contain" />
      <Text style={styles.headerTitle}>收银台</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  mark: { width: 34, height: 40 },
  headerTitle: {
    fontFamily: fontFamily.brand,
    fontSize: 22,
    color: colors.gold,
    letterSpacing: 3,
    includeFontPadding: false,
  },
  loginWrap: { alignItems: "center", gap: 14 },
  lockup: { width: 168, height: 132 },
  loginTitle: {
    fontFamily: fontFamily.brand,
    fontSize: 26,
    color: colors.gold,
    letterSpacing: 6,
    includeFontPadding: false,
  },
});
