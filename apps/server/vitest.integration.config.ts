import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.integration-spec.ts"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 60000, // 容器启动慢，给足超时
    hookTimeout: 60000,
  },
});
