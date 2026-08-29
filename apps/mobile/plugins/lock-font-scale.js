/* global require, module */
const { withMainActivity, withMainApplication } = require("expo/config-plugins");

/**
 * 锁定应用内字体缩放为 1.0（微信式做法）。
 *
 * 背景：收银台排版按 dp 设计。华为/荣耀等机型系统「字体大小/显示大小」
 * 调大（长辈模式常见 1.2~1.4）时，RN 文本若跟随系统缩放，会出现文字
 * 溢出、按钮挤压、行布局错位。
 *
 * 以前的 JS 方案（textDefaults.ts 里给 Text/TextInput 打 defaultProps
 * allowFontScaling:false）在 React 19 + 新架构下失效——React 19 已移除
 * 函数组件 defaultProps。故改为原生层面强制 fontScale=1，需同时覆盖两处：
 *  - MainApplication：bridgeless 模式下 DisplayMetricsHolder 用 Application
 *    级 context 取 scaledDensity（只包 Activity 无效，实测已验证）；
 *  - MainActivity：ReactSurfaceImpl.getFontScale 用 Activity 级 Configuration。
 * 系统输入法、通知等其他界面不受影响。
 */
const METHOD = `
  /**
   * 锁定应用内字体缩放为 1.0，系统字体大小设置不影响 App 内排版。
   */
  override fun attachBaseContext(newBase: android.content.Context) {
    val config = android.content.res.Configuration(newBase.resources.configuration)
    config.fontScale = 1.0f
    super.attachBaseContext(newBase.createConfigurationContext(config))
  }
`;

const ACTIVITY_MARKER = "class MainActivity : ReactActivity() {";
const APPLICATION_MARKER = "class MainApplication : Application(), ReactApplication {";

function inject(src, marker) {
  if (src.includes("attachBaseContext")) return src;
  if (!src.includes(marker)) {
    throw new Error("[lock-font-scale] Kotlin 模板已变化，请同步更新插件匹配规则: " + marker);
  }
  return src.replace(marker, marker + METHOD);
}

module.exports = function lockFontScale(config) {
  config = withMainActivity(config, (c) => {
    c.modResults.language = "kt";
    c.modResults.contents = inject(c.modResults.contents, ACTIVITY_MARKER);
    return c;
  });
  return withMainApplication(config, (c) => {
    c.modResults.language = "kt";
    c.modResults.contents = inject(c.modResults.contents, APPLICATION_MARKER);
    return c;
  });
};
