/* eslint-disable no-undef -- Node CommonJS 配置文件，module.exports 为 Babel 加载约定 */
/**
 * Babel 配置。
 *
 * - `babel-preset-expo`：Expo 默认预设（含 JSX/TS/装饰器等）。
 * - `react-native-reanimated/plugin`：Reanimated 4.x 的 worklet 转换（必须放在最后）。
 *   类型检查无需此插件，但运行时（真机/模拟器）入场动画依赖它。
 *   见 docs/superpowers/plans/2026-08-04-wave4-architecture.md Task 2 Step 1。
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["react-native-reanimated/plugin"],
  };
};
