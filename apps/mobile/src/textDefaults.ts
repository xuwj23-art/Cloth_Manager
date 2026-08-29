import { Text, TextInput } from "react-native";
import { colors } from "./theme/tokens";

/**
 * 注意：React 19 + 新架构已忽略函数组件 defaultProps，这里的
 * allowFontScaling:false 全局补丁【已失效】。真正的字体缩放锁定在
 * plugins/lock-font-scale.js（MainActivity 强制 fontScale=1）。
 * 本文件保留 TextInput 的占位色/去下划线等默认（如同样失效则各处已显式设置）。
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
