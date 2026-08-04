# 第 1 波 · 快速止血 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 5 个低风险、收益立竿见影的 bug/瑕疵，先行合入主干，为后续大重构建立"小步可回滚"的节奏。

**Architecture:** 5 个独立修复，互不依赖，可单独提交。每个都先写测试复现问题（TDD）。改动横跨 shared/server/mobile 三处，但每处改动极小。

**Tech Stack:** TypeScript / Zod / NestJS / React Native / vitest

## Global Constraints

- 金额一律用分（整数），见 PRD §7 规则 1
- 改 shared 后必须 `pnpm --filter @cloth-scan/shared build`（AGENTS.md §2 规则 7）
- Windows/PowerShell 用 `;` 不用 `&&`
- Conventional Commits 中文正文
- 所有改动在 `refactor/fullstack-optimization` 分支
- 每个 task 自检：shared 改动跑 `build && test`；server 跑 `typecheck; test`；mobile 跑 `typecheck`

---

## Task 1: 修复 distributeOrderTotal 整单优惠取整误差（A3）

**Files:**
- Modify: `packages/shared/src/cart.ts:109-134`（`distributeOrderTotal` 函数体）
- Test: `packages/shared/src/cart.test.ts`（新增多件行测试用例）

**Interfaces:**
- Consumes: `CartLine`（`cart.ts` 既有类型）、`cartTotalCents`（既有函数）
- Produces: 修正后的 `distributeOrderTotal(lines, targetCents): CartLine[]`，保证 `cartTotalCents(out) === target` 恒成立（当 `target < orig` 时）

**问题**：当前实现（`cart.ts:128-131`）在"无单件行"时把余数 `per = round(diff/qty)` 补到第一行，不保证摊后合计 == target，可能差几分。

- [ ] **Step 1: 写失败测试（复现 bug）**

在 `packages/shared/src/cart.test.ts` 末尾的 `distributeOrderTotal` describe 块内新增：

```typescript
it("多件行无单件行时，摊后合计必须精确等于目标", () => {
  // 两行各 3 件，原价 100+200=300 分，目标 250 分（优惠 50）
  const lines: CartLine[] = [
    { skuId: "a", name: "A", price: 100, quantity: 3, stock: 10 },
    { skuId: "b", name: "B", price: 200, quantity: 3, stock: 10 },
  ];
  const out = distributeOrderTotal(lines, 250);
  // 核心断言：摊后合计恒等于目标（PRD §7 规则 1：金额精确到分）
  expect(cartTotalCents(out)).toBe(250);
  // 不应有负价
  expect(out.every((l) => l.price >= 0)).toBe(true);
});

it("三行多件时，摊后合计精确等于目标", () => {
  const lines: CartLine[] = [
    { skuId: "a", name: "A", price: 70, quantity: 2, stock: 10 },
    { skuId: "b", name: "B", price: 30, quantity: 2, stock: 10 },
    { skuId: "c", name: "C", price: 50, quantity: 2, stock: 10 },
  ];
  // 原合计 300，目标 199（奇数余数场景）
  const out = distributeOrderTotal(lines, 199);
  expect(cartTotalCents(out)).toBe(199);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd E:/Project/cloth_scan; pnpm --filter @cloth-scan/shared test`
Expected: FAIL，新用例的 `cartTotalCents(out)` 不等于 target（当前算法的余数误差）

- [ ] **Step 3: 修复算法（逐行累加 + 末行吸收余差）**

用以下实现替换 `packages/shared/src/cart.ts:109-134` 的 `distributeOrderTotal` 函数体（保留函数签名和 JSDoc，更新 JSDoc 说明新算法）：

```typescript
/**
 * 整单优惠：把购物车各行价格按比例缩小，使合计精确等于 targetCents。
 *
 * 算法：逐行按比例计算并向下取整累加，余差（target - 已累加）全部由最后一行吸收，
 * 从而保证 cartTotalCents(out) === target 恒成立（PRD §7 规则 1：金额精确到分）。
 *
 * - 仅用于优惠：targetCents ≥ 原总价 或购物车为空时原样返回。
 * - 任一行摊后为负时夹到 0（不倒贴）；夹 0 导致的合计偏差由末行余差吸收补回。
 */
export function distributeOrderTotal(
  lines: CartLine[],
  targetCents: number,
): CartLine[] {
  const orig = cartTotalCents(lines);
  const target = Math.max(0, Math.round(targetCents));
  if (orig <= 0 || target >= orig) return lines.map((l) => ({ ...l }));
  const ratio = target / orig;

  // 逐行按比例取整（向下取整，避免超分），记录每行
  const scaled = lines.map((l) => ({
    ...l,
    price: Math.max(0, Math.floor(l.price * ratio)),
  }));

  // 末行吸收全部余差，保证合计精确等于 target
  const diff = target - cartTotalCents(scaled);
  if (diff !== 0 && scaled.length > 0) {
    const last = scaled[scaled.length - 1]!;
    scaled[scaled.length - 1] = { ...last, price: Math.max(0, last.price + diff) };
  }
  return scaled;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd E:/Project/cloth_scan; pnpm --filter @cloth-scan/shared test`
Expected: PASS（所有用例，含新增 2 个）

- [ ] **Step 5: 构建 shared（server 依赖产物）+ 提交**

```bash
cd E:/Project/cloth_scan
pnpm --filter @cloth-scan/shared build
git add packages/shared/src/cart.ts packages/shared/src/cart.test.ts packages/shared/dist
git commit -m "fix(cart): distributeOrderTotal 改用末行吸收余差保证合计精确到分

原算法在多件无单件行时按 round(diff/qty) 补首行，不保证摊后合计==target，
可能差几分（违背 PRD §7 规则 1）。改为逐行向下取整+末行吸收余差，
保证 cartTotalCents(out)===target 恒成立。补 2 个多件行单测。"
```

---

## Task 2: 修复 SaleDetailScreen.onChanged 未接线（C1）

**Files:**
- Modify: `apps/mobile/App.tsx:42-204`（`AuthedApp` 组件）
- Modify: `apps/mobile/src/screens/SalesScreen.tsx`（接收 refreshKey prop 触发重载）

**Interfaces:**
- Consumes: `SaleDetailScreen` 的 `onChanged?: () => void` prop（已声明于 `SaleDetailScreen.tsx:50`）
- Produces: `AuthedApp` 新增 `salesDirty` state + `refreshSales()` 回调；`SalesScreen` 新增 `refreshKey: number` prop

**问题**：`SaleDetailScreen` 声明了 `onChanged` 且在 save/delete 后调用，但 `App.tsx:169-173` 渲染时没传，导致账单编辑/删除后返回列表看旧数据。

- [ ] **Step 1: 读 App.tsx 确认当前 SaleDetailScreen 渲染与 SalesScreen 的数据加载机制**

Run: `cd E:/Project/cloth_scan; cat apps/mobile/App.tsx`（关注 42-204 行的 AuthedApp，特别是 SalesScreen 和 SaleDetailScreen 的渲染块）

确认：
- `SalesScreen` 的 useEffect 依赖哪些 state（通常是 tab/sel 等）
- `SaleDetailScreen` 的渲染处（约 169-173 行）

- [ ] **Step 2: 在 AuthedApp 加 salesRefreshKey state**

在 `apps/mobile/App.tsx` 的 `AuthedApp` 组件内（与其他 useState 同区域）新增：

```typescript
const [salesRefreshKey, setSalesRefreshKey] = useState(0);
const refreshSales = useCallback(() => setSalesRefreshKey((k) => k + 1), []);
```

（需确保 `useState` / `useCallback` 已从 react 导入，通常 `App.tsx` 顶部已导入）

- [ ] **Step 3: 给 SalesScreen 传 refreshKey 并在 useEffect 依赖它**

在 `App.tsx` 渲染 `<SalesScreen ... />` 处（约 153-167 行的 props 列表）新增 prop：

```typescript
refreshKey={salesRefreshKey}
```

然后编辑 `apps/mobile/src/screens/SalesScreen.tsx`：
- 在组件 props 类型加 `refreshKey?: number`
- 在加载数据的 `useEffect` 依赖数组里加入 `refreshKey`（这样 refreshKey 变化会触发重载）

- [ ] **Step 4: 给 SaleDetailScreen 传 onChanged**

在 `App.tsx` 渲染 `<SaleDetailScreen ... />` 处（约 169-173 行）新增 prop：

```typescript
onChanged={refreshSales}
```

- [ ] **Step 5: 类型检查 + 提交**

```bash
cd E:/Project/cloth_scan
pnpm --filter @cloth-scan/mobile typecheck
git add apps/mobile/App.tsx apps/mobile/src/screens/SalesScreen.tsx
git commit -m "fix(mobile): 账单编辑/删除后销售列表自动刷新（onChanged 接线）

SaleDetailScreen 声明了 onChanged 但 App.tsx 渲染时未传，导致改价/改量/删单/删行后
返回 SalesScreen 仍是旧数据。新增 salesRefreshKey 置脏机制，onChanged 触发 SalesScreen 重载。"
```

---

## Task 3: 修复 LabelPrintScreen 变量先用后声明（C2）

**Files:**
- Modify: `apps/mobile/src/screens/LabelPrintScreen.tsx:234-258`（`handleBtPrint` 内）

**Interfaces:**
- Consumes: `totalLabelCount(job)`（`packages/shared`... 实际是 `apps/mobile/src/printer/labelLayout.ts:231` 已有但当前是死代码）
- Produces: 无新接口

**问题**：`handleBtPrint` 在 `:250` 用 `totalLabels`，但声明在 `:258`。靠 TDZ 侥幸通过，且与 `labelLayout.ts:231` 已有的 `totalLabelCount`（死代码）重复。

- [ ] **Step 1: 确认 totalLabelCount 的签名**

Run: `cd E:/Project/cloth_scan; grep -n "export function totalLabelCount" apps/mobile/src/printer/labelLayout.ts`

确认签名是 `totalLabelCount(job: CtPrintJob): number`（累加 `job.labels.reduce((s,l)=>s+l.copies,0)`）

- [ ] **Step 2: 在 handleBtPrint 内用 totalLabelCount 替代重复计算**

编辑 `apps/mobile/src/screens/LabelPrintScreen.tsx`：
- 在文件顶部确保已从 `labelLayout` 导入 `totalLabelCount`（若未导入，在既有 `import { ... } from "../printer/labelLayout"` 里加上）
- 在 `handleBtPrint`（约 234-256 行）内，把对 `totalLabels` 的**使用**改为 `totalLabelCount(job)`：

```typescript
Alert.alert("已发送打印", `共 ${totalLabelCount(job)} 张标签`);
```

- [ ] **Step 3: 删除 handleBtPrint 之后那行重复的 const totalLabels 声明**

删除 `LabelPrintScreen.tsx:258` 附近的 `const totalLabels = ...`（约 `job.labels.reduce(...)` 那行），因为它现在无人使用且是死代码。

- [ ] **Step 4: 类型检查 + 提交**

```bash
cd E:/Project/cloth_scan
pnpm --filter @cloth-scan/mobile typecheck
git add apps/mobile/src/screens/LabelPrintScreen.tsx
git commit -m "fix(mobile): LabelPrintScreen 变量先用后声明 + 复用 totalLabelCount

handleBtPrint 内引用 totalLabels 但声明在函数后（TDZ 侥幸通过），
且与 labelLayout.ts 已有的 totalLabelCount（原死代码）重复计算。
改为直接调用 totalLabelCount(job)，删除重复声明。"
```

---

## Task 4: 修复后端误导注释（E5）

**Files:**
- Modify: `apps/server/src/products/products.controller.ts:77`（注释）
- Modify: `apps/server/prisma/schema.prisma:80`（注释）

**问题**：注释说"清理图片释放磁盘"，但 `deleteProduct` 实现**不删图**（PRD §7 规则 5 要求保留图）。误导性强。

- [ ] **Step 1: 定位两处错误注释**

Run:
```bash
cd E:/Project/cloth_scan
grep -n "清理图片\|释放磁盘\|clean.*image" apps/server/src/products/products.controller.ts apps/server/prisma/schema.prisma
```

- [ ] **Step 2: 改注释**

在 `apps/server/src/products/products.controller.ts:77` 附近，把"清理图片释放磁盘"相关注释改为：

```typescript
// 软删除商品：置 deletedAt（须先 archived）。不删除任何图片，保留历史账单可看图（PRD §7 规则 5）。
```

在 `apps/server/prisma/schema.prisma:80` 附近，把对应注释改为：

```prisma
  /// 软删除时间戳（须先 archivedAt）。删除时不删图片，保留历史账单可看图（PRD §7 规则 5）。
```

- [ ] **Step 3: 提交**

```bash
cd E:/Project/cloth_scan
git add apps/server/src/products/products.controller.ts apps/server/prisma/schema.prisma
git commit -m "docs(server): 修正 deleteProduct 注释（实际不删图，与实现一致）

原注释说清理图片释放磁盘，但实现保留图片（PRD §7 规则 5：删除商品不删图，
保留历史账单可看图）。修正注释避免误导。"
```

---

## Task 5: 统一 TypeScript 版本（F1）

**Files:**
- Modify: `apps/server/package.json:43`（typescript 版本）
- Modify: `packages/shared/package.json:27`（typescript 版本）
- Modify: `package.json:23`（根 typescript 版本）

**问题**：mobile 是 `~5.9.3`，server/shared/根是 `^5.7.2`，范围语义不同，可能解析到不同 minor，导致两份 TS 共存。

- [ ] **Step 1: 统一为 ~5.9.3（与 mobile 对齐，锁定 5.9.x）**

把三处 typescript 版本都改为 `"typescript": "~5.9.3"`：
- `apps/server/package.json`（devDependencies 内）
- `packages/shared/package.json`（devDependencies 内）
- `package.json`（根 devDependencies 内）

- [ ] **Step 2: 重新安装 + 全量类型检查**

```bash
cd E:/Project/cloth_scan
pnpm install
pnpm --filter @cloth-scan/shared build
pnpm --filter @cloth-scan/server typecheck
pnpm --filter @cloth-scan/mobile typecheck
```

Expected: 全部 PASS（若 mobile 原本就是 5.9.x，server/shared 升上来不应有破坏性变化；5.7→5.9 是向后兼容的 minor）

- [ ] **Step 3: 提交**

```bash
cd E:/Project/cloth_scan
git add package.json apps/server/package.json packages/shared/package.json pnpm-lock.yaml
git commit -m "chore: 统一 TypeScript 版本为 ~5.9.3（消除跨包漂移）

mobile 原为 ~5.9.3，server/shared/根为 ^5.7.2，范围语义不同可能解析到不同 minor。
统一为 ~5.9.3 锁定 5.9.x，避免两份 TS 共存的类型行为差异。"
```

---

## Self-Review

**1. Spec coverage（对照 REFACTOR-OPPORTUNITIES.md 第 1 波）**：
- A3（distributeOrderTotal）→ Task 1 ✅
- C1（onChanged 未接线）→ Task 2 ✅
- C2（变量先用后声明）→ Task 3 ✅
- E5（误导注释）→ Task 4 ✅
- F1（TS 版本漂移）→ Task 5 ✅

**2. Placeholder scan**：无 TBD/TODO，每个 step 都有具体代码或命令。

**3. Type consistency**：
- Task 1 的 `distributeOrderTotal` 签名不变（`CartLine[]` → `CartLine[]`），下游 `CashierScreen` 调用无需改。
- Task 2 的 `refreshKey?: number` 在 SalesScreen 是可选 prop，不破坏既有调用。
- Task 3 的 `totalLabelCount(job)` 签名与原死代码一致。

---

## 第 1 波完成准则

5 个 task 全部提交后，验证：
```bash
cd E:/Project/cloth_scan
pnpm --filter @cloth-scan/shared build; pnpm --filter @cloth-scan/shared test
pnpm --filter @cloth-scan/server typecheck; pnpm --filter @cloth-scan/server test
pnpm --filter @cloth-scan/mobile typecheck
```
全绿即第 1 波完成，可进入第 2 波（`2026-08-04-wave2-correctness.md`）。
