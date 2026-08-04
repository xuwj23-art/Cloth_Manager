import { StyleSheet } from "react-native";
import { colors, font, radius, space, touch } from "../../theme/tokens";

/** 分 → "¥123.45" */
export function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/**
 * Cashier 子组件共用样式。
 * 设计语言（UI-REFERENCES §3）：字号≥16sp、点击区≥48dp、墨绿品牌色、留白分层。
 */
export const cashierStyles = StyleSheet.create({
  // ---- Sheet 容器 ----
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
  },
  /** 底部弹出 Sheet（确认卡 / 优惠 / 改价 / 手输） */
  bottomSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.xl,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  /** 居中卡片（NotFound） */
  centerSheet: {
    position: "absolute",
    left: space.xxl,
    right: space.xxl,
    top: "35%",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.xxl,
    gap: space.sm + 2,
    alignItems: "center",
  },

  // ---- 文本 ----
  titleText: { fontSize: font.title, fontWeight: "800", color: colors.text },
  bodyText: { fontSize: font.body, color: colors.text },
  captionText: { fontSize: font.caption, color: colors.textMuted },
  hint: {
    fontSize: font.caption,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  priceBig: {
    fontSize: font.display - 8,
    fontWeight: "800",
    color: colors.primary,
  },

  // ---- 按钮（≥48dp，主按钮 56dp，§3.3） ----
  /** 主操作大按钮（结算 / 加入 / 确定）—— 墨绿品牌色 */
  primaryBtn: {
    backgroundColor: colors.primary,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xl,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: font.body,
    fontWeight: "800",
  },
  /** 次操作按钮（取消 / 清除优惠）—— 描边 */
  secondaryBtn: {
    flex: 1,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: {
    fontSize: font.body,
    fontWeight: "700",
    color: colors.textMuted,
  },
  disabled: { opacity: 0.5 },

  /** 步进器按钮（- / +）—— ≥48dp，浅墨绿底 */
  stepperBtn: {
    width: touch.buttonHeight,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperText: {
    fontSize: 26,
    color: colors.primary,
    fontWeight: "800",
  },
});
