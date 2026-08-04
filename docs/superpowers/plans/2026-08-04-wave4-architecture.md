# 第 4 波 · 架构性重构 + UI 设计语言落地 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** 四大架构性重构 + 落地中老年友好的 UI 设计语言：① React Navigation 替换手工切屏；② CashierScreen 按 Modal 拆分 + Zustand 状态管理 + 落地 UI 设计语言；③ 离线同步改增量；④ 后端 SalesService 拆分 + 报表优化；⑤ 构建链优化（消除 shared 必 build 痛点）。

**Architecture:** Task 1（导航）是其他 UI task 的基础，先做；Task 2（CashierScreen）依赖 Task 1；Task 3（同步）独立；Task 4（后端 Service 拆分）独立；Task 5（构建链）独立但影响所有 typecheck 体验。

**Tech Stack:** React Navigation 7 / React Native Reanimated 3 / FlashList / Zustand / NestJS / Prisma / TS Project References

## Global Constraints

- **UI 必须遵守 `docs/design/UI-REFERENCES.md` 设计语言**：字号≥16sp、图标+文字双编码入口、点击区≥48dp、单一沉稳品牌色、Reanimated 动画 200-250ms、反模式清单（无隐藏菜单/纯图标Tab/手势返回）
- **保留好设计**：购物车纯函数（`packages/shared/src/cart.ts`）不动业务逻辑、opId 幂等全链路、离线优先结算流程、蓝牙多层防御
- PRD §7 九条不变量不可违背
- 可接受停服切换
- Conventional Commits 中文正文，分支 `refactor/fullstack-optimization`

---

## Task 1: 引入 React Navigation 替换 App.tsx 手工切屏（C3）

**Files:**
- Modify: `apps/mobile/package.json`（加 @react-navigation/native + native-stack）
- Modify: `apps/mobile/App.tsx`（删除手工 Screen switch + BackHandler，改 NavigationContainer）
- Create: `apps/mobile/src/navigation/RootNavigator.tsx`（定义路由 + Stack）
- Modify: 各 Screen 的 props（从"父组件传 setScreen 回调"改为"navigation.navigate + route.params"）
- Modify: `apps/mobile/app.json` 或 `AndroidManifest`（如需）

**背景**：App.tsx 用 useState<Screen> + BackHandler 手工切屏，9 个屏幕状态提升 + 返回逻辑硬编码 + 4 处 null 兜底重复渲染（详见移动端探索报告 §一）。React Navigation 彻底消除这些问题。

- [ ] **Step 1: 装依赖**

```bash
cd E:/Project/cloth_scan
pnpm --filter @cloth-scan/mobile add @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context
```
（react-native-safe-area-context 已装；react-native-screens 需装。Expo 管理原生依赖，可能需 prebuild）

- [ ] **Step 2: 定义路由类型 + Stack**

创建 `apps/mobile/src/navigation/RootNavigator.tsx`：
```typescript
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { SaleOrderDetail } from "@cloth-scan/shared";

// 路由参数类型
export type RootStackParamList = {
  Home: undefined;
  Cashier: undefined;
  Products: { scope?: "active" | "archived" } | undefined;
  CreateProduct: undefined;
  EditProduct: { productId: string };
  Sales: undefined;
  SaleDetail: { orderId: string };
  Staff: undefined;
  LabelPrint: { productId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: {/* 品牌色 */}, headerTitleStyle: {/* 字号 */} }}>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: "首页" }} />
      <Stack.Screen name="Cashier" component={CashierScreen} options={{ title: "扫码收银" }} />
      {/* ... 其余屏幕 */}
    </Stack.Navigator>
  );
}
```

- [ ] **Step 3: 改 App.tsx**

删除 AuthedApp 里的 `useState<Screen>`、`onBack` switch、所有 setScreen 调用、提升的销售状态（salesTab/salesMonth/salesDay/orderId/editing/labelProduct）。AuthedApp 简化为：
```typescript
function AuthedApp() {
  return (
    <NavigationContainer>
      <RootNavigator />
    </NavigationContainer>
  );
}
```
保留 AuthProvider/SyncProvider 包裹层级。

- [ ] **Step 4: 各 Screen 改用 navigation + route**

每个 Screen 组件：
- 删除 `onBack`/`onOpenOrder`/`onScan` 等回调 props
- 改用 `const navigation = useNavigation(); const route = useRoute();`
- 跳转：`navigation.navigate("SaleDetail", { orderId: id })`
- 返回：`navigation.goBack()`
- 读参数：`const { orderId } = route.params`

例如 SalesScreen 删除 tab/month/day 双向绑定 props，改为内部 state + `navigation.addListener("focus", refresh)` 实现返回刷新（顺带替代第 1 波 Task 2 的 salesRefreshKey 机制——但保留 Task 2 的提交，此处复用思路）。

- [ ] **Step 5: header 样式落地设计语言**

按 UI-REFERENCES §3.1：header 用浅灰底/白字、标题字号 18sp、返回箭头用系统标准（中老年熟悉）。

- [ ] **Step 6: typecheck + 真机/模拟器冒烟 + 提交**

```bash
cd E:/Project/cloth_scan
pnpm --filter @cloth-scan/mobile typecheck
```
真机/模拟器验证：9 个屏幕导航、返回栈、参数传递正常。

```bash
git add -A
git commit -m "refactor(mobile): 引入 React Navigation 替换手工切屏（C3）

消除 App.tsx 的 useState<Screen>+BackHandler 手工导航的脆弱性（状态提升、
返回逻辑硬编码、null 兜底重复渲染）。改用 native-stack，9 屏幕映射为路由，
参数传递标准化。header 样式落地设计语言（浅灰底、字号18sp、系统返回箭头）。"
```

---

## Task 2: CashierScreen 拆分 + Zustand + UI 设计语言全面落地（C4）

**Files:**
- Modify: `apps/mobile/package.json`（加 zustand + react-native-reanimated + @shopify/flash-list）
- Create: `apps/mobile/src/screens/cashier/store.ts`（Zustand cart/discount/sheet 状态）
- Create: `apps/mobile/src/screens/cashier/ConfirmCard.tsx`（扫码确认卡 Modal）
- Create: `apps/mobile/src/screens/cashier/ManualInputSheet.tsx`（手动输入）
- Create: `apps/mobile/src/screens/cashier/PriceEditSheet.tsx`（议价改价）
- Create: `apps/mobile/src/screens/cashier/DiscountSheet.tsx`（整单优惠）
- Create: `apps/mobile/src/screens/cashier/NotFoundSheet.tsx`（未找到条码）
- Create: `apps/mobile/src/screens/cashier/CartList.tsx`（购物车列表，用 FlashList）
- Create: `apps/mobile/src/screens/cashier/CheckoutBar.tsx`（底部结算栏）
- Modify: `apps/mobile/src/screens/CashierScreen.tsx`（瘦身为壳，组合子组件）
- Create: `apps/mobile/src/theme/tokens.ts`（设计语言 token：字号/颜色/间距）

**背景**：CashierScreen 976 行/18 useState/5 Modal 堆一起（探索报告 C4）。拆分 + Zustand 管理状态 + 落地 UI-REFERENCES 设计语言（Grab/Starbucks 风格：大按钮、步进器、底部结算栏、Reanimated 入场动画）。

- [ ] **Step 1: 装依赖 + 建 theme tokens**

```bash
pnpm --filter @cloth-scan/mobile add zustand react-native-reanimated @shopify/flash-list
```
（Reanimated 需原生配置，可能需 prebuild）

创建 `apps/mobile/src/theme/tokens.ts`（从 UI-REFERENCES §3 提炼）：
```typescript
export const colors = {
  bg: "#F5F5F7",
  card: "#FFFFFF",
  primary: "#1A5638", // 墨绿（沉稳高级），可调
  text: "#1A1A1A",
  textMuted: "#6B7280",
  border: "#E5E7EB",
};
export const font = {
  display: 36, // 营业额大数字
  title: 18,
  body: 16, // 中老年最小可读
  caption: 14,
};
export const touch = { minSize: 48, buttonHeight: 56 };
export const motion = { pageMs: 220, cardMs: 150 };
```

- [ ] **Step 2: Zustand store**

创建 `apps/mobile/src/screens/cashier/store.ts`：
```typescript
import { create } from "zustand";
import type { CartLine } from "@cloth-scan/shared";
import { addToCartQty, setQuantity, setLinePrice, cartTotalCents } from "@cloth-scan/shared";

type Sheet = "none" | "confirm" | "manual" | "priceEdit" | "discount" | "notFound";

interface CashierState {
  cart: CartLine[];
  pendingSku: CartLine | null; // 确认卡待确认的 sku
  pendingQty: number;
  manualOpen: boolean;
  activeSheet: Sheet;
  editingSkuId: string | null;
  orderDiscountCents: number; // 第2波Task4的订单级优惠
  // actions
  addPending: (line: CartLine, qty: number) => void;
  confirmAdd: () => void;
  setQty: (skuId: string, qty: number) => void;
  editPrice: (skuId: string, price: number) => void;
  setSheet: (s: Sheet) => void;
  setOrderDiscount: (cents: number) => void;
  clear: () => void;
}
export const useCashierStore = create<CashierState>((set, get) => ({
  // ... 实现，调用 shared 的 cart 纯函数
}));
```

- [ ] **Step 3: 拆 5 个 Modal 子组件**

每个 Sheet 子组件从 store 读状态、调 action。按 UI-REFERENCES：
- `ConfirmCard`：大商品图 + 规格 + 价 + 库存 + 数量步进器（-/+ 大按钮 56dp）+ "加入"大按钮（参考 Starbucks）
- `DiscountSheet`：整单优惠（打折/改价两 tab），不再调 distributeOrderTotal，改用 orderDiscountCents（第 2 波 Task 4）
- `PriceEditSheet`：数字键盘改价
- `ManualInputSheet`：数字键盘输条码
- `NotFoundSheet`：未找到提示 + 重新扫码按钮

Reanimated 动画：Sheet 入场用 slide-up + fade（motion.cardMs=150ms），Reanimated `useAnimatedStyle`。

- [ ] **Step 4: CartList（FlashList）+ CheckoutBar**

`CartList`：用 `@shopify/flash-list`（性能好），每行：图+名+规格+价+数量步进器（参考 Starbucks）。`CheckoutBar`：底部固定栏，显示件数 + 总价（优惠后）+ "结算"大按钮（品牌色，56dp 高）。

- [ ] **Step 5: CashierScreen 瘦身为壳**

`CashierScreen.tsx` 从 976 行瘦身到 ~150 行：摄像头视图 + 组合 5 个 Sheet 子组件 + CartList + CheckoutBar。状态全走 Zustand store，不再有 18 个 useState。保留扫码逻辑（handleScanned → store.addPending → open confirm sheet）。

- [ ] **Step 6: 落地设计语言细节**

- 所有文字字号用 theme tokens（body=16sp 起）
- 按钮/步进器点击区 ≥48dp
- 品牌色用于结算按钮/价格强调
- Reanimated 列表项 stagger 淡入（30ms 错位）
- 扫码成功震动（expo-haptics，已有）+ 确认卡 fade-in

- [ ] **Step 7: typecheck + 真机验证 + 提交**

```bash
pnpm --filter @cloth-scan/mobile typecheck
```
真机验证：扫码→确认卡→加车→议价→整单优惠→结算→确认 全流程顺畅，UI 符合中老年友好（大按钮、清晰、动画不晕）。

```bash
git add -A
git commit -m "refactor(cashier): CashierScreen 拆分为子组件 + Zustand + 落地设计语言（C4）

原976行/18useState/5Modal堆一起拆为：ConfirmCard/ManualInputSheet/PriceEditSheet/
DiscountSheet/NotFoundSheet + CartList(FlashList) + CheckoutBar。状态用 Zustand。
落地 UI-REFERENCES 设计语言：theme tokens(字号≥16sp/点击区≥48dp/墨绿品牌色)、
Reanimated 动画(150ms)、Starbucks 式步进器+底部结算大按钮。购物车纯函数保留不动。"
```

---

## Task 3: 离线同步改增量 + 缓存清理（D2 + D3）

**Files:**
- Modify: `apps/server/src/products/products.controller.ts` + `products.service.ts`（listProducts 加 since 参数）
- Modify: `apps/mobile/src/api.ts`（listProducts 加 since 参数）
- Modify: `apps/mobile/src/sync/sync.ts`（pullCatalog 增量 upsert + 删除已删）
- Modify: `apps/mobile/src/db/catalog.ts`（加增量 upsert + deleteByBarcodes）
- Modify: `apps/mobile/src/db/database.ts`（skus_cache 可能加 lastSyncedAt 记录）

**背景**：每 15s 全量拉取所有商品 INSERT OR REPLACE（探索报告 D2）。改增量：后端按 updatedAt 过滤返回，前端增量 upsert + 清理已删（D3）。

- [ ] **Step 1: 后端加 since 参数**

`products.service.ts` 的 listProducts 加可选 `since?: Date` 参数，where 加 `updatedAt: { gt: since }`。同时返回一个 `deletedBarcodes` 列表（最近删除的）——需要查询逻辑：返回 updatedAt > since 且 deletedAt 非空的商品条码供前端删。

`products.controller.ts` 的 GET /products 加 `?since=ISO8601` query 参数。

- [ ] **Step 2: shared 加增量响应类型**

`packages/shared/src/product.ts` 加：
```typescript
export interface CatalogSyncResponse {
  products: ProductWithSkus[];
  deletedBarcodes: string[]; // since 后被删的条码
  serverTime: string; // 本次同步的服务端时间，作为下次 since
}
```
build shared。

- [ ] **Step 3: 前端增量 upsert + 清理**

`catalog.ts` 加 `deleteSkusByBarcodes(db, barcodes)`。`sync.ts` 的 pullCatalog：
- 记录上次同步的 serverTime（存 AsyncStorage 或 skus_cache 的 meta 表）
- 调 `listProducts(since)` 拿增量 + deletedBarcodes
- 增量 upsert（INSERT OR REPLACE）+ 对 deletedBarcodes 执行 DELETE

- [ ] **Step 4: 测试 + 提交**

补 mobile classifySyncError 类似纯逻辑测试（若有新的纯函数）。typecheck + 真机验证同步正常。

```bash
git add -A
git commit -m "feat(sync): 增量同步 + 已删商品缓存清理（D2+D3）

后端 GET /products 加 since 参数返回增量+deletedBarcodes+serverTime，
前端 pullCatalog 改增量 upsert + 清理已删条码。消除每15s全量拉取的流量/电量消耗，
并修复 skus_cache 不清理已删商品的数据卫生问题。"
```

---

## Task 4: SalesService 拆分为 Command/Report + 报表优化（E1 + E2）

**Files:**
- Create: `apps/server/src/sales/sales-command.service.ts`（写：createSale/editOrder/deleteOrder）
- Create: `apps/server/src/sales/sales-report.service.ts`（读：getSummary/report/monthlyReport/listOrders/getOrder）
- Modify: `apps/server/src/sales/sales.service.ts`（删，或保留为 re-export 过渡）
- Modify: `apps/server/src/sales/sales.module.ts` + `sales.controller.ts`（注入两个 service）
- Modify: 报表聚合用 Prisma `aggregate`/`groupBy` 下推 DB（E2）

**背景**：SalesService 619 行承担写+读所有职责（探索报告 E1）。报表实时聚合拉全量到内存（E2）。拆分 + 下推聚合。

- [ ] **Step 1: 拆 SalesCommandService**

把 createSale/editOrder/deleteOrder（含第 2 波 Task 2/3/4 的改动）移到 `sales-command.service.ts`。注入 PrismaService + ProductsService。

- [ ] **Step 2: 拆 SalesReportService**

把 listOrders/getOrder/getSummary/report/monthlyReport/listByDay 移到 `sales-report.service.ts`。只读，注入 PrismaService。

- [ ] **Step 3: 报表聚合下推 DB（E2）**

把 `findMany` + 内存循环聚合（如 report 的 :341-385）改为 Prisma `aggregate`/`groupBy`：
```typescript
const revenueAgg = await tx.saleItem.aggregate({
  where: { order: { shopId, status: "completed", createdAt: { gte: from, lt: to } } },
  _sum: { subtotal: true },
});
```
按天/周下钻用 `groupBy`。

- [ ] **Step 4: controller + module 注入两个 service**

`sales.controller.ts`：写接口（POST/PATCH/DELETE）注入 SalesCommandService，读接口（GET）注入 SalesReportService。module providers 加两个。

- [ ] **Step 5: 测试调整 + 提交**

原有 spec 的 mock 调整为对两个新 service。跑 unit + integration。
```bash
git add -A
git commit -m "refactor(sales): SalesService 拆分 Command/Report + 报表聚合下推DB（E1+E2）

619行单Service拆为 SalesCommandService(写) + SalesReportService(读)。
报表聚合从 findMany+内存循环改为 Prisma aggregate/groupBy 下推，减少内存占用与查询量。
单测/integration 测试调整通过。"
```

---

## Task 5: 构建链优化（F3 + F4，消除 shared 必 build 痛点）

**Files:**
- Modify: `tsconfig.base.json`（加 references 支持）
- Modify: `packages/shared/tsconfig.json`（保留 composite）
- Modify: `apps/server/tsconfig.json`（加 references 指向 shared）
- Modify: `turbo.json`（typecheck/test 去掉 ^build 依赖）
- Modify: `apps/server/package.json`（typecheck 改 tsc --build --noEmit 或 paths 方案）

**背景**：turbo typecheck/test 依赖 ^build，每次先 build shared（emit dist），慢且违背增量（探索报告 F3）。shared 的 composite:true 是孤立配置（F4）。

- [ ] **Step 1: 选方案并实施**

推荐方案 B（Project References）：
- `tsconfig.base.json` 加 `composite: true`（如需）
- `apps/server/tsconfig.json` 加 `references: [{ path: "../../packages/shared" }]`
- server typecheck 改用 `tsc --noEmit -p .`（配合 references，TS 自动用 shared 源码做类型检查，无需 dist）
- `turbo.json` 的 typecheck/test 去掉 `dependsOn: ["^build"]`

若 Project References 与 NestCLI 装饰器冲突，退方案 A（paths）：server tsconfig 加 `paths: { "@cloth-scan/shared": ["../../packages/shared/src"] }` + `baseUrl`。

- [ ] **Step 2: 验证不破坏现有流程**

```bash
cd E:/Project/cloth_scan
# 不先 build shared，直接 typecheck server，应通过（读 shared 源码）
pnpm --filter @cloth-scan/server typecheck
pnpm --filter @cloth-scan/server test
pnpm --filter @cloth-scan/mobile typecheck
```

- [ ] **Step 3: 更新 AGENTS.md §2 规则 7**

规则 7 原文"改共享包要先 build"——改方案后可能不再需要（typecheck 直读源码）。但 server 运行时（node dist/main.js）仍需 shared 有 dist。**保守做法**：保留 build 步骤在 server build 前（turbo build 的 ^build 链保留），仅 typecheck/test 解耦。更新文档说明"typecheck 无需先 build，但 build server 仍需先 build shared"。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(ts): Project References 解耦 typecheck/test 与 shared build（F3+F4）

shared 的 composite:true 终于接入 references 链。server typecheck 直读 shared
源码，无需先 build dist，turbo typecheck/test 去掉 ^build 依赖提速。
build 链保留（server 运行时仍需 shared dist）。AGENTS.md §2 规则7更新。"
```

---

## Self-Review

**1. Spec coverage**：
- C3（React Navigation）→ Task 1 ✅
- C4（CashierScreen 拆分 + UI 设计语言）→ Task 2 ✅
- D2+D3（增量同步 + 缓存清理）→ Task 3 ✅
- E1+E2（SalesService 拆分 + 报表优化）→ Task 4 ✅
- F3+F4（构建链）→ Task 5 ✅

**2. 依赖链**：
- Task 1（导航）必须先于 Task 2（CashierScreen 依赖导航的 navigation/useRoute）
- Task 2 同时落地 UI 设计语言（theme tokens 供后续 Task 复用）
- Task 3/4/5 互相独立，可并行

**3. 风险**：
- Task 1/2 装新原生依赖（react-native-screens/Reanimated/FlashList）需 prebuild + 重打包，不能 OTA
- Task 2 是最大最复杂的 task，建议拆成多个提交（store → 1 个 Sheet → ... → 整合），且每步真机验证
- Task 5 的 Project References 与 NestCLI 兼容性需实测，备选 paths 方案
- UI 设计语言落地涉及全屏幕（不只 CashierScreen），Task 2 只落地 cashier + 建 tokens，其余屏幕在第 5 波统一应用
