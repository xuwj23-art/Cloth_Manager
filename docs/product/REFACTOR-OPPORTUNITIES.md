# 重构机会清单（全栈探索汇总）

> 本文件是重构探索阶段的产出，由 4 个 code-explorer 子代理 + Serena 深挖四块（后端/移动端/shared/全局）后汇总。
> **目的**：作为后续 `superpowers:writing-plans` 写重构方案的事实输入。
> **权威性**：参考性（非权威），与代码冲突时以代码为准。已核实项标注 ✅。
> 日期：2026-08-04

---

## 阅读指引

- **严重度**：🔴 必改（影响正确性/安全/稳定性）｜🟠 强烈建议（改善可维护性/DX）｜🟡 可选（锦上添花）
- **工作量**：粗估人日（含测试）
- **依赖**：标注哪些项应一起做（"先 X 再 Y"）

---

## 一、汇总概览

| 分组 | 必改 | 强烈建议 | 可选 | 小计 |
|------|:---:|:---:|:---:|:---:|
| A. 正确性与并发安全 | 4 | 0 | 0 | 4 |
| B. 类型契约对齐（shared ↔ Prisma） | 3 | 0 | 0 | 3 |
| C. 移动端架构与体验 | 4 | 2 | 3 | 9 |
| D. 离线同步引擎 | 1 | 2 | 0 | 3 |
| E. 后端可维护性与性能 | 0 | 2 | 4 | 6 |
| F. 工程化与质量基础设施 | 0 | 4 | 3 | 7 |
| **合计** | **12** | **10** | **10** | **32** |

> 总工作量粗估：必改项约 8-10 人日；强烈建议约 10-14 人日；可选约 6-8 人日。**全量约 24-32 人日**（实际取决于取舍）。

---

## 二、A 组 · 正确性与并发安全（PRD §7 不变量执行缺陷）

> 这些是产品正确性的硬伤，PRD §7 明确要求，但当前实现有缺陷。重构**必须优先处理**。

### A1 🔴 `createSale` opId 幂等存在 TOCTOU 竞态 ✅ 已核实
- **问题**：`findUnique(opId)` 检查与 `create(opId)` 不原子，并发同 opId 第二个请求会抛未捕获的 `P2002`（unique 冲突），返回 500。底层 unique 约束保证了"最多扣一次"，但错误码不友好，移动端同步引擎可能误判。
- **位置**：`apps/server/src/sales/sales.service.ts:67-72`（检查）+ `:111-121`（创建）
- **建议**：捕获 `PrismaClientKnownRequestError` 且 `code==="P2002"` → 重新 `findUnique` 返回已存在单；或事务内 `upsert`。补并发测试。
- **工作量**：0.5 人日

### A2 🔴 防超卖缺原子性，乐观锁声明了但没启用 ✅ 已核实
- **问题**：事务内"读 stock → 校验 → decrement"非原子，并发可超卖。`Sku.version` 注释写"乐观锁"但 `update` 的 `where` 没带 version，等于没用。
- **位置**：`apps/server/src/sales/sales.service.ts:86-140`（createSale）、`:226-263`（editOrder）
- **建议**：改原子条件更新 `updateMany({ where: { id, stock: { gte: qty } }, data: { stock: { decrement: qty } } })`，检查 `count===1`；或启用真乐观锁（where 带 version，失败重试）。`editOrder` 同理。
- **工作量**：1 人日（含并发测试）
- **依赖**：与 A1 一起做（都在 createSale 事务里）

### A3 🔴 `distributeOrderTotal` 整单优惠取整有误差 ✅ 已核实
- **问题**：多件无单件行时，余数 `per = round(diff/qty)` 补到第一行，**不保证摊后合计 == target**。用户看到的"折后总价"与实际入库各行 subtotal 之和可能差几分，违背 PRD §7 规则 1（金额精确到分）的精神。该分支无单测。
- **位置**：`packages/shared/src/cart.ts:128-131` + `cart.test.ts`（缺测）
- **建议**：改算法为"逐行累加、最后一行吸收全部余差"，保证 `cartTotalCents(out) === target` 恒成立；补多件行单测。
- **工作量**：0.5 人日
- **依赖**：独立，可优先做（影响收银金额准确性）

### A4 🔴 订单物理删除丢失审计痕迹 ✅ 已核实
- **问题**：`deleteOrder` 直接 `saleOrder.delete`，误删单无法追溯。schema 已有 `SaleOrderStatus.voided` 枚举却没用。
- **位置**：`apps/server/src/sales/sales.service.ts:193`
- **建议**：改软删除（`status:"voided"` + 可选 `deletedAt`），报表查询都已过滤 `status:"completed"`，改造成本低。保留库存回滚逻辑。
- **工作量**：0.5 人日

---

## 三、B 组 · 类型契约对齐（shared schema ↔ Prisma 模型脱节）

> PRD §7 的多条不变量在 shared 类型层无载体，"类型契约"与"数据模型"脱节，重构易引入不一致。

### B1 🔴 `SaleItemSchema` 缺 `cost` 字段 ✅ 已核实
- **问题**：shared 的 `SaleItem`（`sale.ts:5-12`）无 `cost`，Prisma `SaleItem.cost`（`schema.prisma:154`）是"进价快照"，是 PRD §7 规则 8 的载体。shared 类型无法表达该字段。
- **位置**：`packages/shared/src/sale.ts:5-12`
- **建议**：给 `SaleItemSchema` 加 `cost: Money`；评估 `SaleItemDetail` 是否对 owner 暴露 cost（店员权限下不应见）。
- **工作量**：0.5 人日

### B2 🔴 `ProductSchema` 缺 `deletedAt` ✅ 已核实
- **问题**：`product.ts:24-35` 无 `deletedAt`，但 Prisma 有。PRD §7 规则 5（软删除）在类型层不可见。
- **位置**：`packages/shared/src/product.ts:24-35`
- **建议**：加 `deletedAt: z.string().datetime().nullable().optional()`，或建模"已删商品不返回"的窄类型。
- **工作量**：0.5 人日

### B3 🔴 售罄归档逻辑 `recomputeArchive` 未抽到 shared ✅ 已核实
- **问题**：PRD §7 规则 7 的核心不变量只在后端 `products.service.ts:261` 实现，前端无法复用判定。
- **位置**：`apps/server/src/products/products.service.ts:261-285`
- **建议**：抽 `shouldArchive(totalStock, archivedAt, deletedAt): boolean` 纯函数到 shared，server 调用，前端按需复用。
- **工作量**：1 人日（含单测）

---

## 四、C 组 · 移动端架构与体验

### C1 🔴 `SaleDetailScreen.onChanged` 未接线，账单编辑/删除后列表不刷新 ✅ 已核实
- **问题**：`SaleDetailScreen` 声明了 `onChanged` 且在 save/delete 后调用，但 `App.tsx:169-173` 渲染时没传。结果：编辑账单或删单后返回列表看到的是旧数据。
- **位置**：`apps/mobile/App.tsx:169-173`；`apps/mobile/src/screens/SaleDetailScreen.tsx:50,132,152`
- **建议**：在 `AuthedApp` 加 `salesDirty` 置脏机制触发刷新；或引入 React Navigation 的 focus 监听。
- **工作量**：0.5 人日

### C2 🔴 `LabelPrintScreen` 变量先用后声明 ✅ 已核实
- **问题**：`handleBtPrint` 在 `:250` 用 `totalLabels`，但声明在 `:258`。靠 TDZ 侥幸通过，且与已有逻辑重复。
- **位置**：`apps/mobile/src/screens/LabelPrintScreen.tsx:250`（用）vs `:258`（声明）
- **建议**：复用 `labelLayout.ts:231` 已有的 `totalLabelCount(job)`（当前是死代码），删除重复计算。
- **工作量**：0.1 人日

### C3 🔴 App.tsx 无导航库，状态提升 + 返回逻辑脆弱 ✅ 已核实
- **问题**：手工 `switch` 切屏 + `BackHandler` 硬编码 + 4 处 null 兜底重复渲染 + 6 个销售内部状态提升到顶层。新增屏幕或调整流程极易出错。
- **位置**：`apps/mobile/App.tsx:31-204` 整体
- **建议**：引入 `@react-navigation/native` + `native-stack`。9 个屏幕映射为 route，`orderId`/`product` 作为 params。可删除 7 个 useState 和整个 `onBack` switch。
- **工作量**：2-3 人日（含回归测试）

### C4 🔴 `CashierScreen` 976 行 / 18 useState / 5 Modal 堆一起 ✅ 已核实
- **问题**：最关键路径的屏幕最难维护。5 个 Modal（确认卡/未找到/手动输入/议价/整单优惠）+ 购物车 + 摄像头 + 结算栏全在一个组件。
- **位置**：`apps/mobile/src/screens/CashierScreen.tsx` 整体，重点 `:87-113`（state）、`:454-741`（5 Modal）
- **建议**：按 Modal 拆子组件；引入 Zustand 管理 cart+discount+sheetOpen 三组状态。**务必保留** `packages/shared/src/cart.ts` 纯函数不动。
- **工作量**：3-4 人日
- **依赖**：建议在 C3（导航）之后做

### C5 🟠 工具函数重复（`yuan()` 等 7 处） ✅ 已核实
- **问题**：`function yuan(cents)` 在 7 个屏幕各定义一遍；`formatTime` 也重复。
- **建议**：抽到 `apps/mobile/src/utils/format.ts`（或部分抽到 shared）。
- **工作量**：0.3 人日

### C6 🟠 `failed` 的 outbox op 无 UI 入口 ✅ 已核实
- **问题**：被服务端拒绝的单（如超卖）在 outbox 标记 failed，但全 App 无任何屏幕展示，店主完全无感知。
- **建议**：HomeScreen 或新建"同步异常"屏幕，列出 failed op + 重试/放弃操作。
- **工作量**：1 人日

### C7 🟡 加载/空/错误三态处理风格不统一
- **建议**：抽 `<StateView loading error empty>` 组件。工作量：0.5 人日

### C8 🟡 ErrorBoundary 无"重试"按钮
- **问题**：渲染错误后只能杀进程重启。位置：`App.tsx:232-257`。工作量：0.1 人日

### C9 🟡 硬编码后端 IP + 明文 HTTP
- **位置**：`apps/mobile/src/config.ts:9`、`app.json:71`
- **建议**：HTTPS+域名 + `app.config.ts` 环境变量切 dev/prod。工作量：后端 HTTPS 1 人日 + 前端 0.2 人日（与 E5 关联）

---

## 五、D 组 · 离线同步引擎

### D1 🔴 乐观扣库存与 pull 的竞态 ✅ 已核实
- **问题**：`doCheckout` 乐观扣本地库存，若 push 因网络错保留 pending 而 pull 先到，本地库存会"跳回"导致短暂超卖窗口。
- **位置**：`apps/mobile/src/sync/sync.ts:67-74` + `db/catalog.ts:62-71`
- **建议**：pull 时对 pending outbox 涉及的 skuId 跳过 stock 覆盖，或 merge（本地 = 服务端 stock - pending 未同步数量）。
- **工作量**：1 人日

### D2 🟠 整目录拉取，无增量同步 ✅ 已核实
- **问题**：`pullCatalog` 每 15s 全量拉所有商品 `INSERT OR REPLACE`。`skus_cache` 有 `updatedAt` 字段但从未用于过滤。杂款店铺 SKU 多时流量与电量双耗。
- **位置**：`apps/mobile/src/sync/sync.ts:25-28`、`db/catalog.ts:17-46`
- **建议**：后端加 `?since=<updatedAt>` 参数返回增量 + 已删列表；前端增量 upsert + 对已删条目 DELETE。
- **工作量**：后端 1 人日 + 前端 1 人日

### D3 🟠 `skus_cache` 从不清理已删商品（数据卫生） ✅ 已核实
- **问题**：`upsertCatalog` 只 INSERT OR REPLACE 从无 DELETE，后端软删的商品在本地永远存在。
- **位置**：`apps/mobile/src/db/catalog.ts`（缺 DELETE 分支）
- **建议**：随 D2 一起改；若 D2 不做，至少加"本地有但服务端无的 barcode → 删除"。
- **工作量**：0.3 人日（与 D2 同做）
- **依赖**：与 D2 一起做

---

## 六、E 组 · 后端可维护性与性能

### E1 🟠 `SalesService` 过长（619 行），职责过多
- **问题**：一个 Service 承担"开单+流水+5 种报表+编辑+删除"。
- **位置**：`apps/server/src/sales/sales.service.ts` 整体
- **建议**：拆为 `SalesCommandService`（写）与 `SalesReportService`（读）。报表纯读，易缓存/换预聚合。
- **工作量**：1 人日

### E2 🟠 报表实时聚合无缓存/预聚合
- **问题**：`report`/`monthlyReport` 把整月所有单 + 明细拉到 Node 内存循环聚合。单量大时性能问题。
- **位置**：`apps/server/src/sales/sales.service.ts:332-453`
- **建议**：短期用 `groupBy`/`aggregate` 下推 DB；长期按天预聚合表。当前小数据量不紧急。
- **工作量**：短期 1 人日，长期 2-3 人日

### E3 🟡 `TxClient = any` 丧失事务内类型安全
- **位置**：`apps/server/src/products/products.service.ts:17`、`:261`
- **建议**：用 Prisma 的 `Prisma.TransactionClient` 类型。工作量：0.5 人日

### E4 🟡 JWT secret 有 dev 兜底弱密钥
- **位置**：`apps/server/src/auth/auth.module.ts:16`（`JWT_SECRET ?? "dev-insecure-secret"`）
- **建议**：生产启动强校验 JWT_SECRET 长度（<32 字符拒绝启动）；上 HTTPS。工作量：0.5 人日（强校验）

### E5 🟡 注释与实现矛盾（误导性文档）
- **位置**：`apps/server/src/products/products.controller.ts:77`（注释说"清理图片"，实现不删图）；`schema.prisma:80` 同样错误
- **建议**：改注释为"软删除，保留图片"。工作量：10 分钟

### E6 🟡 spec 文件中文乱码 + `SaleItem.cost` 历史回填为 0 ✅ 已核实
- **问题1**：`sales.service.spec.ts` 等中文注释全变 `?`（编码损坏），测试名不可读。
- **问题2**：`add_saleitem_cost` 迁移加 `cost Int @default(0)` 未回填，迁移前历史单 cost 全是 0，报表利润偏高。
- **建议**：spec 重写可读中文；评估历史数据（试运行期量小，可接受或用当前 costPrice 回填）。
- **工作量**：spec 0.5 人日；数据评估 0.5 人日

### E7 🟡 其他后端小项（汇总）
- `listOrders` 硬编码 `take:500` 无分页（`:154`）— 工作量 0.5 人日
- `$transaction` 内逐条 await 循环（`:123-141`）— 工作量 0.5 人日
- download 页 HTML 内联 controller（141 行字符串）— 工作量 0.5 人日
- 环境变量无启动校验（fail-fast）— 工作量 0.5 人日

---

## 七、F 组 · 工程化与质量基础设施

### F1 🟠 TypeScript 版本漂移（mobile `~5.9.3` vs server/shared `^5.7.2`）✅ 已核实
- **位置**：`apps/mobile/package.json:40`
- **建议**：统一版本范围，或引入 pnpm catalog（见 F2）。工作量：15 分钟

### F2 🟠 引入 pnpm catalog 统一跨包依赖版本
- **问题**：typescript/vitest/zod 等在各 package.json 独立声明，无单一真相源（F1 是症状）。
- **建议**：`pnpm-workspace.yaml` 加 `catalog:` 段，各包用 `catalog:` 引用。工作量：1 小时

### F3 🟠 `turbo.json` 的 typecheck/test 依赖 `^build`（shared 必先编译）
- **问题**：每次 typecheck/test 都先 build shared（emit dist），慢且违背增量。是 AGENTS.md §2 规则 7"改 shared 要先 build"痛点的根因。
- **位置**：`turbo.json:14-19`
- **建议**：方案(a) server typecheck 直读 shared 源码（tsconfig paths），去 `^build`；方案(b) 引入 TS project references（shared 的 `composite:true` 已是前提），用 `tsc --build`。
- **工作量**：方案(a) 0.5 人日；方案(b) 1-2 人日
- **依赖**：与 F4 关联

### F4 🟠 shared 的 `composite:true` 是孤立配置（无 references 链）
- **位置**：`packages/shared/tsconfig.json:9`
- **建议**：补全 project references（配合 F3 方案 b），或删 `composite` 避免误导。工作量：10 分钟

### F5 🟠 移动端零测试，同步引擎/outbox 无回归网
- **问题**：mobile 无任何单测，重构同步引擎/outbox 全靠手工验证。
- **建议**：至少为同步纯函数（push/pull 顺序、opId 去重、冲突策略）和 outbox 状态机补单测；UI 层后置。
- **工作量**：2-4 人日（建测试基础设施 + 覆盖核心）
- **依赖**：D 组同步重构前应先补

### F6 🟠 完全无 CI/CD
- **问题**：所有质量检查只在本地手动跑，PR 无门禁。
- **建议**：最小 GitHub Actions：PR 触发 `install → shared build → turbo typecheck test`。mobile build 留手动。
- **工作量**：0.5-1 人日

### F7 🟡 E2E 脚本编码损坏（GBK）+ 覆盖单一 ✅ 已核实
- **位置**：`tools/e2e-product-edit.ps1` 中文全乱码，只测商品编辑
- **建议**：转 UTF-8 BOM；扩展覆盖销售开单/幂等/库存流水；考虑跨平台工具。工作量：转码 10 分钟 + 扩展 1-2 人日

### F8 🟡 无 ESLint/Prettier/Husky/lint-staged/commitlint
- **建议**：根级 flat config + Prettier + husky pre-commit + commitlint。工作量：1 人日（含修初次 lint 报错）

### F9 🟡 server tsconfig 放松了严格性
- **位置**：`apps/server/tsconfig.json:14-15`（关了 `strictPropertyInitialization` 和 `noUncheckedIndexedAccess`）
- **建议**：逐步恢复（`strictPropertyInitialization` 半天；`noUncheckedIndexedAccess` 2-3 天）

---

## 八、被排除的"伪问题"（探索误报，已核实）

| 项 | 报告来源 | 核实结果 |
|---|---|---|
| android/ 与 build 产物被提交进 git | 全局 H1 | ✅ **未追踪**，.gitignore 生效正常，CNG 原则在执行 |
| docs 里的 APK 是构建产物 | 全局 H1 | 是厂商 SDK demo APK，参考资料，保留无害 |

---

## 九、值得保留的好设计（重构时务必不丢）

> 这些是项目里架构最干净的部分，重构时**只能强化不能破坏**。

1. **opId 幂等贯穿全链路**：客户端 genOpId → outbox 主键 `INSERT OR IGNORE` → 后端 `SaleOrder.opId` unique。PRD §7.3 核心。
2. **购物车纯函数共享包**（`packages/shared/src/cart.ts`）：业务规则集中、可测、前后端共享。**最佳设计范本**。
3. **真正的 zod schema 共享**：`ZodValidationPipe` + shared schema，入站 DTO 在 controller 层统一校验。
4. **金额用分 + `Money` 复用**：从 schema 层杜绝浮点元。
5. **进价快照**（`SaleItem.cost`）：简单有效，保证历史利润不被改价污染。
6. **售罄归档 `recomputeArchive` 集中化 + 事务内调用**：`deletedAt 不复活`守卫是关键细节。
7. **门店隔离的"双校验"模式**：每个 `findUnique` 后校验 shopId，防越权 + 防 ID 枚举差异泄漏。
8. **离线优先结算流程**：写 outbox → 乐观扣本地库存 → 立即提示 → 后台同步。
9. **同步状态机的错误三分**：400/409 → failed（不重试）、网络/5xx → pending（重试）。
10. **蓝牙打印的多层防御**：init 提前 + 主线程强制 + 稳定窗口 + 不可重入 + 超时兜底 + 中文错误码翻译。
11. **shared 包 `exports` 双入口**：RN 直读源码、Node 走产物，优雅解决跨端消费。
12. **Dockerfile 的 `--filter` 隔离安装 + 生产 compose 强制敏感变量 + PG healthcheck**：部署侧教科书做法。
13. **tsconfig.base.json 的严格基线**（`noUncheckedIndexedAccess` 等）。
14. **token 用 SecureStore 加密存储**。
15. **`expandSkuMatrix` 抽到 shared + 单测互验**：schema 与函数互验的好模式。

---

## 十、建议的重构推进顺序（供 brainstorm 参考）

> 不预设最终方案，仅给出逻辑依赖链，供与用户对齐目标时参考。

**第 1 波 · 快速止血（约 2 人日，纯 bug 修复）**
- A3（整单优惠取整）、C1（onChanged 未接线）、C2（变量先用后声明）、E5（误导注释）、F1（TS 版本统一）
- 这批改动小、风险低、收益立竿见影，可先行合入。

**第 2 波 · 正确性硬伤（约 3 人日）**
- A1 + A2（幂等 TOCTOU + 防超卖原子性）一起做，补并发测试
- A4（订单软删除）
- D1（乐观扣与 pull 竞态）
- B1/B2/B3（类型契约对齐）

**第 3 波 · 测试基础设施先行（约 2-4 人日）**
- F5（mobile 同步引擎单测）、F6（最小 CI）、F8（lint/format/hooks）
- 在大重构前补上回归网，降低后续风险。

**第 4 波 · 架构性重构（约 6-10 人日，需 brainstorm 对齐）**
- C3（React Navigation）、C4（CashierScreen 拆分）— 移动端架构
- D2+D3（增量同步）— 同步引擎重做
- E1+E2（SalesService 拆分 + 报表优化）— 后端架构
- F3+F4（构建链优化）— 工程化

**第 5 波 · 锦上添花（按需）**
- C5-C9、E3/E4/E6/E7、F7/F9 等

> 以上顺序的逻辑：先修 bug → 补正确性 → 补测试网 → 再做大重构 → 最后打磨。具体取舍需与你 brainstorm 确定。
