import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.expo/**",
      "**/node_modules/**",
      "**/android/**",
      "**/ios/**",
      // 原生 Kotlin 打印机模块（ct-printer），非 TS
      "**/modules/ct-printer/android/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // 渐进式：核心规则 error，风格类 warn
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // 防御性初值（如 health 检查的 fallback）误报，降为 warn
      "no-useless-assignment": "warn",
      // RN 静态资源加载（require('./asset.png')）是官方模式，非 CommonJS
      "@typescript-eslint/no-require-imports": "warn",
      // CJK 全角空格（U+3000）是 UI 文案的合法排版，非零宽字符
      "no-irregular-whitespace": "warn",
      // ESLint v10 新规则，对 RN 原生桥接的简短错误包装噪音较大
      "preserve-caught-error": "warn",
    },
  },
);
