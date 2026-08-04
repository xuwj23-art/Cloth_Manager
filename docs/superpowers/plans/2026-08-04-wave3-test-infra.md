# 第 3 波 · 测试基础设施 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** 在第 4 波大重构前补上回归网：mobile 同步引擎/outbox 纯逻辑单测、最小 CI（PR 触发 typecheck+test）、ESLint+Prettier+husky+commitlint 代码质量基线。

**Architecture:** Task 1 给 mobile 装 vitest，覆盖可纯测的同步/outbox 逻辑（依赖 RN 的 UI 层暂不测）。Task 2 加 GitHub Actions 最小 CI。Task 3 配 lint/format/hooks。三者独立。

**Tech Stack:** vitest / GitHub Actions / ESLint flat config / Prettier / husky / lint-staged / commitlint

## Global Constraints

- mobile 测试聚焦"不依赖 RN 运行时的纯逻辑"（同步状态分类、opId 去重、冲突策略），UI 组件测试后置（第 4 波引入 React Navigation 后再评估 RTL）
- CI 要能在无 Docker 环境（GitHub Actions 免费_runner）跑 unit 测试；集成测试（需 testcontainers）标记为可选 job
- lint 初次启用必有大量历史告警，用 `--max-warnings` 渐进式，先 error 级、warning 暂放过
- 分支 `refactor/fullstack-optimization`，Conventional Commits 中文正文

---

## Task 1: mobile 同步引擎/outbox 单元测试

**Files:**
- Modify: `apps/mobile/package.json`（加 vitest 依赖 + test 脚本）
- Create: `apps/mobile/vitest.config.ts`
- Create: `apps/mobile/src/sync/__tests__/sync.test.ts`（同步逻辑纯函数测试）
- Create: `apps/mobile/src/db/__tests__/outbox.test.ts`（opId 去重/状态机逻辑）

**背景**：mobile 零测试，第 4 波要重构同步引擎（增量同步 D2/D3），必须先有回归网。同步引擎里有些逻辑可抽为纯函数测（如错误分类、pending/synced/failed 状态判定），有些依赖 SQLite 需 mock。

- [ ] **Step 1: 装依赖 + vitest 配置**

```bash
cd E:/Project/cloth_scan
pnpm --filter @cloth-scan/mobile add -D vitest
```

创建 `apps/mobile/vitest.config.ts`：
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node", // 同步纯逻辑不依赖 RN 运行时
    globals: true,
  },
});
```

在 `apps/mobile/package.json` scripts 加 `"test": "vitest run"`。

- [ ] **Step 2: 抽取可测的同步纯逻辑**

检查 `apps/mobile/src/sync/sync.ts`，把"错误分类"逻辑（判断 HTTP status 决定 failed/pending）抽成纯函数导出，例如：
```typescript
/** 根据错误类型决定 outbox op 的下一状态 */
export function classifySyncError(status: number | "network"): "failed" | "pending" {
  if (status === 400 || status === 409 || (typeof status === "number" && status >= 400 && status < 500)) return "failed";
  return "pending"; // 网络错或 5xx 重试
}
```
（若 sync.ts 已有内联逻辑，refactor 抽出，不改行为）

- [ ] **Step 3: 写同步纯逻辑测试**

`apps/mobile/src/sync/__tests__/sync.test.ts`：
```typescript
import { describe, it, expect } from "vitest";
import { classifySyncError } from "../sync";

describe("classifySyncError（同步错误分类）", () => {
  it("400 业务拒绝 → failed（不重试）", () => {
    expect(classifySyncError(400)).toBe("failed");
  });
  it("409 冲突 → failed", () => {
    expect(classifySyncError(409)).toBe("failed");
  });
  it("500 服务端错 → pending（重试）", () => {
    expect(classifySyncError(500)).toBe("pending");
  });
  it("network 网络错 → pending", () => {
    expect(classifySyncError("network")).toBe("pending");
  });
});
```

- [ ] **Step 4: 写 outbox opId 去重测试**

opId 去重靠 SQLite 主键 `INSERT OR IGNORE`，不易纯测；改为测"入队逻辑的幂等性契约"——mock 一个内存版的 enqueueSale，验证相同 opId 两次入队只产生一条记录。若 outbox.ts 的 enqueueSale 直接依赖 SQLiteDatabase 无法 mock，则跳过本步并在 ledger 记录"outbox 测试需 integration 层（第 4 波接 maestro 或 e2e）"。

- [ ] **Step 5: 跑测试 + 提交**

Run: `pnpm --filter @cloth-scan/mobile test`
Expected: classifySyncError 用例 PASS。

```bash
git add apps/mobile/package.json apps/mobile/vitest.config.ts apps/mobile/src/sync/ apps/mobile/pnpm-lock.yaml
git commit -m "test(mobile): 引入 vitest + 同步错误分类纯函数单测

mobile 原零测试，第4波要重构同步引擎需先补回归网。抽 classifySyncError 纯函数
（HTTP status → failed/pending 分类），加单测覆盖 400/409/500/network 四类。
outbox 的 SQLite 主键幂等属集成层，留待第4波 e2e 覆盖。"
```

---

## Task 2: 最小 GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

**背景**：完全无 CI，所有质量检查靠本地手动。加最小 CI：PR 触发 typecheck + unit test（server + shared + mobile），集成测试（需 Docker）单独可选 job。

- [ ] **Step 1: 写 CI 配置**

创建 `.github/workflows/ci.yml`：
```yaml
name: CI
on:
  pull_request:
    branches: [main, refactor/fullstack-optimization]
  push:
    branches: [refactor/fullstack-optimization]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.34.1
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @cloth-scan/shared build
      - run: pnpm --filter @cloth-scan/shared test
      - run: pnpm --filter @cloth-scan/server typecheck
      - run: pnpm --filter @cloth-scan/server test
      - run: pnpm --filter @cloth-scan/mobile typecheck
      - run: pnpm --filter @cloth-scan/mobile test

  # 集成测试需 Docker（testcontainers），单独 job，可选
  integration-tests:
    runs-on: ubuntu-latest
    continue-on-error: true # 可选，不阻塞 PR
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.34.1
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @cloth-scan/shared build
      - run: pnpm --filter @cloth-scan/server prisma:generate
      - run: pnpm --filter @cloth-scan/server test:integration
```

- [ ] **Step 2: 提交**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: 新增 GitHub Actions（PR 触发 typecheck + unit test，集成测试可选）

unit-tests job：shared/server/mobile 的 typecheck + test，PR 必过
integration-tests job：server testcontainers 集成测试，需 Docker，continue-on-error 可选"
```

---

## Task 3: ESLint + Prettier + husky + commitlint

**Files:**
- Create: `eslint.config.js`（根，flat config）
- Create: `.prettierrc.json`（根）
- Create: `.editorconfig`（根）
- Create: `commitlint.config.js`（根）
- Modify: `package.json`（根，加 husky/lint-staged/commitlint 依赖 + prepare 脚本）
- Create: `.husky/pre-commit`、`.husky/commit-msg`
- Modify: `apps/server/package.json`（修正 lint 脚本指向根 config）

**背景**：完全无 lint/format/hooks，代码风格无强制。TECH-NOTES §4.3 已承认。渐进式：先 error 级，warning 放过。

- [ ] **Step 1: 装依赖**

```bash
cd E:/Project/cloth_scan
pnpm add -D -w eslint @eslint/js typescript-eslint prettier eslint-config-prettier \
  husky lint-staged @commitlint/cli @commitlint/config-conventional
pnpm prepare-husky  # 或 npx husky init
```

- [ ] **Step 2: ESLint flat config（根）**

创建 `eslint.config.js`：
```javascript
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.expo/**", "**/node_modules/**", "**/android/**", "**/ios/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // 渐进式：先开 error 级核心规则，warning 类暂放过
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn", // warn 而非 error，避免海量报错
    },
  },
);
```

- [ ] **Step 3: Prettier + editorconfig**

`.prettierrc.json`：
```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

`.editorconfig`：
```
root = true
[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
```

- [ ] **Step 4: commitlint**

`commitlint.config.js`：
```javascript
export default {
  extends: ["@commitlint/config-conventional"],
};
```

- [ ] **Step 5: husky hooks**

`.husky/pre-commit`：
```bash
pnpm lint-staged
```

`.husky/commit-msg`：
```bash
pnpm commitlint --edit $1
```

`package.json`（根）加：
```json
"scripts": {
  "prepare": "husky",
  "lint": "eslint .",
  "format": "prettier --write ."
},
"lint-staged": {
  "*.{ts,tsx,js}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml}": ["prettier --write"]
}
```

- [ ] **Step 6: 修 server lint 脚本 + 验证**

`apps/server/package.json` 的 lint 脚本改为 `"lint": "eslint \"src/**/*.ts\""`（指向根 config）。

验证：
```bash
cd E:/Project/cloth_scan
pnpm --filter @cloth-scan/server lint   # 应能跑（可能有 warn，不应崩）
pnpm --filter @cloth-scan/mobile typecheck  # 确认 flat config 不影响 tsc
```

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "chore: ESLint + Prettier + husky + commitlint 代码质量基线

渐进式启用：ESLint flat config（no-unused-vars error、no-explicit-any warn），
Prettier 统一格式，husky pre-commit 跑 lint-staged，commit-msg 跑 commitlint
强制 Conventional Commits。.editorconfig 统一编码/换行。"
```

---

## Self-Review

**1. Spec coverage**：
- F5（mobile 同步单测）→ Task 1 ✅
- F6（CI）→ Task 2 ✅
- F8（lint/hooks）→ Task 3 ✅

**2. 风险**：
- Task 3 启用 ESLint 后历史代码可能有大量 warning（尤其 `no-explicit-any`）——用 warn 级而非 error 级规避阻塞，后续第 5 波再收紧
- Task 1 的 outbox 测试依赖 SQLite 难纯测，已标注"留待第 4 波 e2e"
- Task 2 的 integration-tests job 用 continue-on-error 可选，避免 testcontainers 在 CI 环境的问题阻塞 PR
