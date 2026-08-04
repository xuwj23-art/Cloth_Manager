import { defineConfig } from "vitest/config";

/**
 * mobile 单测聚焦"不依赖 RN 运行时的纯逻辑"（同步错误分类、状态机判定等）。
 *
 * alias 把 RN 原生模块指向空桩：sync.ts 的可测函数本身不触碰这些依赖，
 * 但其 import 图（db → expo-sqlite → react-native）会拉入 RN 运行时。
 * react-native 发布的 index.js 含 Flow 语法 `import typeof * as ...`，
 * vitest 的 Rollup 解析器无法直接处理，故整条原生链路用空桩隔离。
 */
export default defineConfig({
  resolve: {
    alias: {
      "react-native": __dirname + "/src/__mocks__/noop.js",
      "expo-sqlite": __dirname + "/src/__mocks__/noop.js",
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node", // 同步纯逻辑不依赖 RN 运行时
    globals: true,
  },
});
