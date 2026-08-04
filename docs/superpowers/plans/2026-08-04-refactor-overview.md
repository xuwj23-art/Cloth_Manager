# 全栈重构总纲（Plan of Plans）

> **说明**：本文件是 32 项重构机会（见 `docs/product/REFACTOR-OPPORTUNITIES.md`）的执行编排总纲。
> 因规模大、跨四个独立子系统（后端/移动端/shared/工程化），按 superpowers:writing-plans 的 scope check 拆成 5 个独立 plan，每个 plan 产出可独立测试运行的软件。
>
> **决策前提**（用户已确认）：范围=全部 32 项；接受 React Navigation/CashierScreen 拆分/同步引擎重做/后端 Service 拆分；可接受停服切换（允许数据迁移脚本、不强制向后兼容）。
>
> 日期：2026-08-04

---

## 执行波次与 Plan 映射

每波是一个独立 plan 文件，按依赖顺序执行。前置波未完成时不得启动后续波。

| 波次 | Plan 文件 | 内容 | 前置 | 粗估 |
|------|----------|------|------|------|
| **第 1 波** | `2026-08-04-wave1-quick-fixes.md` | 快速止血：5 个低风险 bug 修复 | 无 | ~2 人日 |
| **第 2 波** | `2026-08-04-wave2-correctness.md` | 正确性硬伤：幂等/防超卖/订单软删/同步竞态/类型契约 | 第 1 波 | ~3 人日 |
| **第 3 波** | `2026-08-04-wave3-test-infra.md` | 测试基础设施：mobile 同步单测 + CI + lint/hooks | 第 2 波 | ~3 人日 |
| **第 4 波** | `2026-08-04-wave4-architecture.md` | 架构性重构：React Navigation + CashierScreen 拆分 + 增量同步 + SalesService 拆分 + 构建链 | 第 3 波 | ~8 人日 |
| **第 5 波** | `2026-08-04-wave5-polish.md` | 锦上添花：工具函数抽取/StateView/HTTPS/分页/环境校验等 | 第 4 波 | ~6 人日 |

---

## 各波内容明细

### 第 1 波 · 快速止血（独立小修复，先行合入）
- **A3** `distributeOrderTotal` 整单优惠取整误差 → 改"逐行累加+末行吸收余差"算法 + 补多件行单测
- **C1** `SaleDetailScreen.onChanged` 未接线 → App.tsx 加置脏机制
- **C2** `LabelPrintScreen` 变量先用后声明 → 复用 `totalLabelCount(job)`
- **E5** 后端误导注释（"清理图片"实际不删图）→ 改注释
- **F1** TypeScript 版本漂移 → 统一为 `~5.9.3`

### 第 2 波 · 正确性硬伤
- **A1 + A2** createSale 幂等 TOCTOU + 防超卖缺锁（一起做，补并发测试，可能需真实 PG 集成测试）
- **A4** 订单物理删除改软删除（用 `voided` 状态）
- **D1** 乐观扣库存与 pull 的竞态（pull 时跳过 pending sku）
- **B1** SaleItemSchema 加 cost 字段
- **B2** ProductSchema 加 deletedAt
- **B3** recomputeArchive 抽 shouldArchive 纯函数到 shared

### 第 3 波 · 测试基础设施（在大重构前补回归网）
- **F5** mobile 同步引擎/outbox 纯函数单测（建测试基础设施）
- **F6** 最小 GitHub Actions CI（PR 触发 typecheck + test）
- **F8** ESLint flat config + Prettier + husky + lint-staged + commitlint

### 第 4 波 · 架构性重构
- **C3** 引入 React Navigation 替换 App.tsx 手工切屏
- **C4** CashierScreen 拆分（按 Modal 拆子组件 + Zustand 状态管理）
- **D2 + D3** 增量同步（后端 since 参数 + 前端增量 upsert + 缓存清理）
- **E1 + E2** SalesService 拆分为 Command/Report + 报表优化
- **F3 + F4** 构建链优化（去 typecheck 的 ^build 依赖 / project references）

### 第 5 波 · 锦上添花
- **C5** yuan()/formatTime() 工具函数抽取
- **C6** failed outbox op 的 UI 入口
- **C7** StateView 统一三态
- **C8** ErrorBoundary 加重试按钮
- **C9** HTTPS + 域名 + app.config.ts
- **E3** TxClient 用 Prisma.TransactionClient 类型
- **E4** JWT secret 启动强校验
- **E6** spec 中文乱码重写 + SaleItem.cost 历史回填评估
- **E7** listOrders 分页 / 事务批量化 / download HTML 模板 / 环境变量校验
- **F2** pnpm catalog
- **F7** E2E 脚本转码 + 扩展覆盖
- **F9** server tsconfig 收紧严格性

---

## 跨波全局约束

每个 plan 的所有 task 都隐含遵守：

1. **PRD §7 的 9 条业务不变量不可违背**（金额用分、库存走流水、opId 幂等、防超卖、软删除不删图、门店隔离、售罄归档、进价快照、QR 仅含编号）。
2. **黄金规则**（AGENTS.md §2）：改 shared 要 build；Windows 用 `;` 不用 `&&`；提交用 Conventional Commits 中文正文。
3. **每个 task 自检**：改后端跑 `pnpm --filter @cloth-scan/server typecheck && pnpm --filter @cloth-scan/server test`；改 shared 跑 `build && test`；改 mobile 跑 `typecheck`。
4. **保留好设计**（REFACTOR-OPPORTUNITIES.md §九 的 15 项）：opId 全链路、购物车纯函数、zod 共享、进价快照等只能强化不能破坏。
5. **分支**：所有改动在 `refactor/fullstack-optimization` 分支。
