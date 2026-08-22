import { Text, TextInput } from "react-native";
import { colors } from "./theme/tokens";

/**
 * 收银机布局按 dp 排，不能跟着系统「字体大小 / 显示大小」一起放大。
 * 华为等机型默认字号偏大时，占位符会被裁掉、三列表头会折行。
 */
function patchDefaults(
  component: { defaultProps?: Record<string, unknown> | undefined },
  extra: Record<string, unknown> = {},
) {
  component.defaultProps = {
    ...(component.defaultProps ?? {}),
    allowFontScaling: false,
    maxFontSizeMultiplier: 1,
    ...extra,
  };
}

patchDefaults(Text as unknown as { defaultProps?: Record<string, unknown> });
patchDefaults(TextInput as unknown as { defaultProps?: Record<string, unknown> }, {
  placeholderTextColor: colors.textMuted,
  underlineColorAndroid: "transparent",
});
