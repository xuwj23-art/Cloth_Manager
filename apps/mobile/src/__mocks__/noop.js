// vitest 桩：RN 原生模块在 node 环境下无实现，纯逻辑单测不需要它们。
// 通过 vitest.config.ts 的 alias 把 react-native / expo-sqlite 指向此文件。
export default {};
export const Platform = { OS: "android", select: (o) => o.android };
