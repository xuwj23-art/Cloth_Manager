# 第 5 波 · 锦上添花 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** 收尾打磨：工具函数抽取、统一三态组件、HTTPS、分页、环境校验、剩余屏幕 UI 设计语言统一应用、lint 收紧、spec 乱码修复、E2E 扩展等。各项独立，可按需挑选执行。

**Architecture:** 本波各项**相互独立**，无依赖关系，不要求全做。按优先级排序，每项一个小 task。建议按"影响面/成本"比挑选。

**Tech Stack:** 同前波

## Global Constraints

- 同前波（PRD §7、设计语言、Conventional Commits、分支 refactor/fullstack-optimization）
- 本波所有 UI 改动继续遵守 `docs/design/UI-REFERENCES.md`

---

## Task 1: 工具函数抽取 yuan()/formatTime()（C5）

**Files:**
- Create: `apps/mobile/src/utils/format.ts`
- Modify: 7 个屏幕（删除本地 yuan/formatTime 定义，改 import）

- [ ] **Step 1: 建 utils/format.ts**：抽取 `yuan(cents): string`、`formatTime(iso): string`，按设计语言字号/格式。
- [ ] **Step 2: 全局替换**：grep `function yuan` 找到 7 处定义，删除并改 `import { yuan } from "../utils/format"`。formatTime 同理。
- [ ] **Step 3: typecheck + 提交**

```bash
git commit -m "refactor(mobile): 抽取 yuan/formatTime 工具函数到 utils/format（C5）"
```

---

## Task 2: failed outbox op 的 UI 入口（C6）

**Files:**
- Create: `apps/mobile/src/screens/SyncErrorsScreen.tsx`（或在 HomeScreen 加入口）
- Modify: `apps/mobile/src/db/outbox.ts`（加 listFailed）

- [ ] **Step 1: outbox.ts 加 listFailed**：`SELECT * FROM outbox WHERE status='failed' ORDER BY createdAt DESC`
- [ ] **Step 2: 新建 SyncErrorsScreen**：列出 failed op（error 信息 + 时间），提供"重试"（改回 pending）/"放弃"（删除）按钮。
- [ ] **Step 3: HomeScreen 加入口**：当 failed count > 0 时，首页顶部显示警告条"有 N 笔同步失败，点查看"。
- [ ] **Step 4: 提交**

```bash
git commit -m "feat(mobile): failed outbox op 的 UI 入口（同步异常列表+重试/放弃）（C6）"
```

---

## Task 3: 统一三态组件 StateView（C7）

**Files:**
- Create: `apps/mobile/src/components/StateView.tsx`
- Modify: 各屏幕替换内联 loading/error/empty

- [ ] **Step 1: 建 StateView**：`<StateView loading? error? empty? onRetry?>`，按设计语言（大图标+文字+重试按钮，字号16sp）。
- [ ] **Step 2: 各屏幕替换**：ProductsScreen/StaffScreen/SalesScreen/SaleDetailScreen 的内联三态改用 StateView。
- [ ] **Step 3: 提交**

---

## Task 4: ErrorBoundary 加重试按钮（C8）

**Files:**
- Modify: `apps/mobile/App.tsx:232-257`

- [ ] **Step 1: ErrorBoundary 的 renderError 加"重新加载"按钮**：`onPress={() => this.setState({ error: null, hasError: false })}`。
- [ ] **Step 2: 提交**

---

## Task 5: HTTPS + 域名 + app.config.ts（C9）

**Files:**
- Modify: `apps/mobile/src/config.ts`（或改 app.config.ts + 环境变量）
- 后端：服务器侧上 HTTPS（反代或直接 TLS，部署文档已有）
- Modify: `apps/mobile/app.json`（usesCleartextTraffic 关闭）

- [ ] **Step 1: 后端上 HTTPS**：Nginx 反代 + Let's Encrypt（见 docs/服务器部署指南.md）。
- [ ] **Step 2: config.ts 改 HTTPS 域名**：`API_HOST = "https://yourdomain.com"`。
- [ ] **Step 3: app.json 关 usesCleartextTraffic**：删除或置 false。
- [ ] **Step 4: 验证 + 提交**

> 本 task 依赖域名/服务器配置，可能需用户侧操作。

---

## Task 6: TxClient 用 Prisma.TransactionClient 类型（E3）

**Files:**
- Modify: `apps/server/src/products/products.service.ts:17`（删除 `type TxClient = any`）

- [ ] **Step 1: 替换为 `Prisma.TransactionClient`**：`import type { Prisma } from "@prisma/client";` 参数类型用 `Prisma.TransactionClient`。
- [ ] **Step 2: typecheck + 提交**

---

## Task 7: JWT secret 启动强校验（E4）

**Files:**
- Modify: `apps/server/src/auth/auth.module.ts:16`

- [ ] **Step 1: 去掉 dev 兜底弱密钥**：
```typescript
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("JWT_SECRET 必须配置且长度≥32字符（生产安全要求）");
}
```
- [ ] **Step 2: 本地 dev 用 .env 配一个≥32字符的 secret**。
- [ ] **Step 3: 提交**

---

## Task 8: spec 中文乱码重写 + SaleItem.cost 历史回填评估（E6）

**Files:**
- Modify: `apps/server/src/sales/sales.service.spec.ts`（重写中文注释/用例名）
- Modify: 其余 .spec.ts 有乱码的同理
- 数据：评估是否回填历史 SaleItem.cost

- [ ] **Step 1: 重写 spec 中文**：乱码（`????`）改回可读中文。
- [ ] **Step 2: SaleItem.cost 历史评估**：查迁移前历史单数量，若少则接受（默认0成本=利润偏高），若多则写回填脚本（用 Sku 当前 costPrice）。
- [ ] **Step 3: 提交**

---

## Task 9: 后端小项汇总（E7）

- **listOrders 分页**（`sales.service.ts:154`）：加 cursor/skip+take 分页。
- **事务批量化**（`sales.service.ts:123-141`）：`createMany`/`updateMany` 替代逐条 await。
- **download HTML 抽模板**（`download.controller.ts:62-141`）：抽独立 .html 文件。
- **环境变量启动校验**：bootstrap 用 Zod 校验 process.env，fail-fast。

每项独立提交。

---

## Task 10: pnpm catalog（F2）

**Files:**
- Modify: `pnpm-workspace.yaml`（加 catalog 段）
- Modify: 各 package.json（`"typescript": "catalog:"` 等）

- [ ] **Step 1: pnpm-workspace.yaml 加 catalog**：统一 typescript/vitest/zod 等版本。
- [ ] **Step 2: 各 package.json 改用 `catalog:`**。
- [ ] **Step 3: pnpm install + typecheck 验证 + 提交**

---

## Task 11: E2E 脚本转码 + 扩展（F7）

**Files:**
- Modify: `tools/e2e-product-edit.ps1`（转 UTF-8 BOM）
- Create: `tools/e2e-sale-flow.ps1`（销售开单+幂等+库存流水）
- 评估：是否换跨平台工具（Maestro）

- [ ] **Step 1: ps1 转 UTF-8 BOM**（PowerShell 5.x 需要 BOM 才能正确显示中文）。
- [ ] **Step 2: 扩展覆盖销售开单/幂等/库存流水链路**。
- [ ] **Step 3: 评估 Maestro**（跨平台 YAML e2e，若合适则迁移）。

---

## Task 12: server tsconfig 收紧严格性（F9）

**Files:**
- Modify: `apps/server/tsconfig.json:14-15`

- [ ] **Step 1: 恢复 strictPropertyInitialization: true**：用 `!` definite assignment 修饰 DI 注入字段。
- [ ] **Step 2: 评估 noUncheckedIndexedAccess**（成本高，2-3 天，可选）。

---

## Task 13: 剩余屏幕 UI 设计语言统一应用

**Files:**
- Modify: HomeScreen/ProductsScreen/SalesScreen/SaleDetailScreen/CreateProductScreen/StaffScreen/LabelPrintScreen

**背景**：第 4 波 Task 2 只落地了 CashierScreen + theme tokens。本 task 把设计语言（UI-REFERENCES）应用到其余所有屏幕：
- HomeScreen：四宫格入口（Grab 风格，图标+文字双编码）+ 今日营业额大数字卡（Monzo 风格）
- ProductsScreen：大封面卡片（Etsy 风格）
- SalesScreen：大数字卡 + 日期分组流水 + 简单柱状图
- CreateProductScreen：顶部照片区 + 垂直字段（Vestiaire 风格）
- 所有屏幕：统一字号 token、品牌色、Reanimated 入场动画

- [ ] 按屏幕逐个改造，每个独立提交（真机验证）。

---

## Self-Review

**1. Spec coverage（对照 REFACTOR-OPPORTUNITIES.md 第 5 波）**：
- C5→Task1, C6→Task2, C7→Task3, C8→Task4, C9→Task5
- E3→Task6, E4→Task7, E6→Task8, E7→Task9
- F2→Task10, F7→Task11, F9→Task12
- 剩余屏幕 UI 统一→Task 13

**2. 推荐执行优先级**（若不全做）：
- 高价值低成本：Task 1（工具抽取）、Task 4（ErrorBoundary 重试）、Task 6（TxClient 类型）、Task 7（JWT 校验）、Task 8（spec 乱码）
- 高价值中成本：Task 2（failed op UI）、Task 5（HTTPS）、Task 13（UI 统一）
- 低优先级：Task 9/10/11/12（工程化打磨，按需）

**3. 风险**：
- Task 5（HTTPS）依赖域名/服务器，需用户侧配合
- Task 13（UI 统一）工作量大（7 个屏幕），建议在第 4 波 CashierScreen 稳定后再批量推进
- Task 12 的 noUncheckedIndexedAccess 成本高，可选
