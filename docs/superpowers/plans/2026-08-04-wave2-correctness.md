# 第 2 波 · 正确性硬伤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 7 个正确性硬伤：幂等竞态、防超卖缺锁、订单级优惠字段、订单软删除、同步竞态、3 处 shared↔Prisma 类型契约脱节。建立 testcontainers 真实 PG 并发测试基础设施。

**Architecture:** Task 1 先搭 testcontainers 测试基座（后续并发测试都依赖它）；Task 2-3 修 createSale 的幂等+防超卖（都在同一事务，一起改）；Task 4-5 改 SaleOrder 模型（加 orderDiscountCents 订单级优惠 + 改 voided 软删除），一次迁移；Task 6 修同步竞态；Task 7-9 对齐 shared 类型契约。

**Tech Stack:** NestJS / Prisma 6 / PostgreSQL 16 / Zod / testcontainers / React Native (Expo) / SQLite

## Global Constraints

- PRD §7 九条不变量不可违背（金额用分、库存走流水、opId 幂等、防超卖、软删除不删图、门店隔离、售罄归档、进价快照、QR 仅含编号）
- 改 shared 后必须 `pnpm --filter @cloth-scan/shared build`
- 改 schema 必须新建迁移（不能只改 schema 不生成迁移）
- Windows/PowerShell 用 `;` 不用 `&&`（Git Bash 内可用 `&&`）
- Conventional Commits 中文正文
- 分支 `refactor/fullstack-optimization`
- **可接受停服切换**（用户已确认）：允许数据迁移脚本、一次性升级、不强制向后兼容旧客户端
- 保留好设计：opId unique 约束、recomputeArchive 集中化、门店隔离双校验、进价快照、购物车纯函数（第 1 波已验证这些是地基）

---

## Task 1: 搭建 testcontainers 真实 PG 并发测试基础设施

**Files:**
- Create: `apps/server/test/pg-container.ts`（testcontainers PG 启动 + prisma client 工厂）
- Create: `apps/server/src/sales/sales.service.concurrency.spec.ts`（并发测试占位，验证基础设施可用）
- Modify: `apps/server/package.json`（加 testcontainers 依赖 + test:integration 脚本）
- Modify: `apps/server/vitest.config.ts`或新增 `vitest.integration.config.ts`（区分 unit/integration）

**Interfaces:**
- Produces: `withPg(fn: (prisma) => Promise<T>): Promise<T>` 辅助函数，每个集成测试用例在真实 PG 里跑，结束自动清理

**背景**：当前后端测试全是 mock Prisma，测不出真实并发（A1/A2 盲区）。testcontainers 起一次性 PG 容器，跑完销毁。

- [ ] **Step 1: 安装 testcontainers 依赖**

```bash
cd E:/Project/cloth_scan
pnpm --filter @cloth-scan/server add -D testcontainers @testcontainers/postgresql
```

- [ ] **Step 2: 创建 PG 容器 + Prisma client 工厂**

创建 `apps/server/test/pg-container.ts`：

```typescript
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";

let container: StartedPostgreSqlContainer | null = null;
let prisma: PrismaClient | null = null;

/**
 * 启动一次性 PG 容器并跑迁移，返回已建表的 PrismaClient。
 * 同一进程内复用（启动慢，约 1-2 秒）；测试套件结束由 afterAll 销毁。
 */
export async function startPg(): Promise<PrismaClient> {
  if (prisma) return prisma;
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("cloth_test")
    .start();
  const url = container.getConnectionUri();
  // 用容器的 DATABASE_URL 跑迁移（deploy 幂等）
  execSync(`pnpm --filter @cloth-scan/server prisma migrate deploy`, {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
  prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
  return prisma;
}

export async function stopPg(): Promise<void> {
  if (prisma) { await prisma.$disconnect(); prisma = null; }
  if (container) { await container.stop(); container = null; }
}

/** 清空所有业务表（每条测试前调用，保证隔离） */
export async function resetDb(p: PrismaClient): Promise<void> {
  const tables = ["stockMovement", "saleItem", "saleOrder", "sku", "product", "category", "user", "shop"];
  for (const t of tables) {
    // @ts-expect-error 动态表名
    await p[t].deleteMany({});
  }
}
```

- [ ] **Step 3: 创建集成测试配置（与 unit 分离）**

创建 `apps/server/vitest.integration.config.ts`：

```typescript
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
```

在 `apps/server/package.json` 的 scripts 加：
```json
"test:integration": "prisma generate && vitest run --config vitest.integration.config.ts"
```

- [ ] **Step 4: 写一个冒烟测试验证基础设施可用**

创建 `apps/server/src/sales/sales.service.integration-spec.ts`（先只验证容器能起 + 迁移能跑 + 能查）：

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { startPg, stopPg, resetDb } from "../../test/pg-container";

describe("PG 容器集成测试基础设施", () => {
  let prisma: PrismaClient;
  beforeAll(async () => { prisma = await startPg(); });
  afterAll(async () => { await stopPg(); });

  it("容器已启动且能建表（SELECT 1 成功）", async () => {
    const r = await prisma.$queryRaw`SELECT 1 AS ok`;
    expect((r as any)[0].ok).toBe(1);
  });

  it("能创建测试数据并清理", async () => {
    await resetDb(prisma);
    const shop = await prisma.shop.create({ data: { name: "测试店" } });
    expect(shop.id).toBeDefined();
    await resetDb(prisma);
    const count = await prisma.shop.count();
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 5: 运行集成测试验证**

Run: `cd E:/Project/cloth_scan; pnpm --filter @cloth-scan/server test:integration`
Expected: PASS（容器启动 + 迁移 + 查询 + 清理全通）。需要本机 Docker Desktop 运行。

- [ ] **Step 6: 提交**

```bash
git add apps/server/test/pg-container.ts apps/server/vitest.integration.config.ts apps/server/src/sales/sales.service.integration-spec.ts apps/server/package.json pnpm-lock.yaml
git commit -m "test(server): 搭建 testcontainers 真实 PG 集成测试基础设施

为验证 A1（幂等并发）A2（防超卖原子性）等真实事务行为，引入 testcontainers
起一次性 PG 容器跑迁移+测试。与 unit 测试分离（vitest.integration.config.ts），
避免日常 unit 测试依赖 Docker。冒烟测试验证容器启动/迁移/清理链路。"
```

---

## Task 2: 修复 createSale 幂等 TOCTOU + 防超卖缺锁（A1 + A2）

**Files:**
- Modify: `apps/server/src/sales/sales.service.ts:62-150`（createSale 整个方法）
- Test: `apps/server/src/sales/sales.service.integration-spec.ts`（并发测试）

**Interfaces:**
- Consumes: Task 1 的 `startPg/resetDb`
- Produces: createSale 并发安全（同 opId 重复提交返回同一单不重复扣；并发不超卖）

**问题 A1**：`sales.service.ts:67-72` 先 `findUnique(opId)` 检查，若不存在进事务 create。并发同 opId 第二个请求可能都通过检查，第二个在事务内 create 抛 `P2002`（unique 冲突），未捕获返回 500。
**问题 A2**：`sales.service.ts:94-98` 读 stock → 校验 → decrement 非原子，并发可超卖。`version` 字段 update 时 increment 但 where 没带 version，乐观锁失效。

- [ ] **Step 1: 写失败并发测试（A1 幂等竞态）**

在 `sales.service.integration-spec.ts` 新增（需先 seed 一个店+商品+SKU 库存 10）：

```typescript
import { SalesService } from "./sales.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProductsService } from "../products/products.service";

async function seedFixture(p: PrismaClient) {
  await resetDb(p);
  const shop = await p.shop.create({ data: { name: "并发测试店" } });
  const user = await p.user.create({ data: { shopId: shop.id, phone: "13900000000", passwordHash: "x", role: "owner" } });
  const product = await p.product.create({ data: { shopId: shop.id, name: "测试款", coverImage: null } });
  const sku = await p.sku.create({ data: { productId: product.id, barcode: "CONC-001", color: "默认", size: "均", costPrice: 5000, salePrice: 9900, stock: 10, version: 0 } });
  // 初始库存流水
  await p.stockMovement.create({ data: { skuId: sku.id, type: "in", quantity: 10, opId: "seed-in" } });
  return { shopId: shop.id, userId: user.id, skuId: sku.id };
}

describe("createSale 并发安全（A1 幂等 + A2 防超卖）", () => {
  let prisma: PrismaClient;
  let sales: SalesService;
  beforeAll(async () => {
    prisma = await startPg();
    sales = new SalesService(prisma as any, new ProductsService(prisma as any));
  });
  afterAll(async () => { await stopPg(); });

  it("A1: 同一 opId 并发提交两次，只扣一次库存且都返回同一单", async () => {
    const { shopId, userId, skuId } = await seedFixture(prisma as any);
    const input = { opId: "op-concurrent-1", items: [{ skuId, quantity: 3, price: 9900 }] };
    const [r1, r2] = await Promise.all([
      sales.createSale(shopId, userId, input),
      sales.createSale(shopId, userId, input),
    ]);
    expect(r1.id).toBe(r2.id); // 同一单
    const sku = await prisma.sku.findUnique({ where: { id: skuId } });
    expect(sku!.stock).toBe(7); // 10 - 3，只扣一次
  });

  it("A2: 并发各买剩余全部库存，不应超卖（stock 不得为负）", async () => {
    const { shopId, userId, skuId } = await seedFixture(prisma as any);
    // 库存 10，两个请求各买 8（合计 16 > 10），应一个成功一个失败
    const results = await Promise.allSettled([
      sales.createSale(shopId, userId, { opId: "op-race-a", items: [{ skuId, quantity: 8, price: 9900 }] }),
      sales.createSale(shopId, userId, { opId: "op-race-b", items: [{ skuId, quantity: 8, price: 9900 }] }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1); // 只有一个成功
    expect(failed.length).toBe(1);
    const sku = await prisma.sku.findUnique({ where: { id: skuId } });
    expect(sku!.stock).toBe(2); // 10 - 8
    expect(sku!.stock).toBeGreaterThanOrEqual(0); // 不得为负
  });
});
```

- [ ] **Step 2: 运行验证测试失败**

Run: `cd E:/Project/cloth_scan; pnpm --filter @cloth-scan/server test:integration`
Expected: A1 测试可能偶尔通过（竞态不总触发），A2 测试应失败（两个都成功，stock 变 -6 或因 unique 冲突一个 500）。

- [ ] **Step 3: 修复 createSale（A1 捕获 P2002 + A2 原子条件更新）**

替换 `apps/server/src/sales/sales.service.ts` 的 createSale 方法（:62-150）。关键改动：
1. 移除外层 `findUnique(opId)` 预检查，直接进事务（消除 TOCTOU 窗口）
2. 事务内 `create` 包 try/catch，捕获 `P2002` → 回查返回已存在单
3. 防超卖改原子条件更新：`updateMany({ where: { id, stock: { gte: qty } }, data: { stock: { decrement: qty } } })`，检查 `count === 1`，否则抛库存不足

```typescript
async createSale(
  shopId: string,
  operatorId: string | null,
  input: CreateSaleOrderInput,
) {
  try {
    return await this.prisma.$transaction(
      async (tx) => {
        let total = 0;
        const itemsData: { skuId: string; quantity: number; price: number; cost: number; subtotal: number }[] = [];
        const affectedProductIds = new Set<string>();

        for (const item of input.items) {
          // 原子防超卖：用 updateMany 带 stock>=qty 条件，count===1 才成功
          const updated = await tx.sku.updateMany({
            where: { id: item.skuId, product: { shopId }, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity }, version: { increment: 1 } },
          });
          if (updated.count !== 1) {
            // 库存不足或 SKU 不存在/跨店——回查给准确错误
            const sku = await tx.sku.findUnique({ where: { id: item.skuId }, include: { product: true } });
            if (!sku || sku.product.shopId !== shopId) throw new NotFoundException(`SKU 不存在：${item.skuId}`);
            throw new BadRequestException(`库存不足：${sku.barcode} 现有 ${sku.stock}，需 ${item.quantity}`);
          }
          // 回查拿 costPrice（快照）和 salePrice（price 兜底）
          const sku = await tx.sku.findUnique({ where: { id: item.skuId }, include: { product: true } });
          affectedProductIds.add(sku!.productId);
          const price = item.price ?? sku!.salePrice;
          const subtotal = price * item.quantity;
          total += subtotal;
          itemsData.push({ skuId: sku!.id, quantity: item.quantity, price, cost: sku!.costPrice, subtotal });
        }

        const order = await tx.saleOrder.create({
          data: { shopId, operatorId, status: "completed", totalAmount: total, opId: input.opId, items: { create: itemsData } },
          include: { items: true },
        });

        for (const item of itemsData) {
          await tx.stockMovement.create({
            data: { skuId: item.skuId, type: "out", quantity: -item.quantity, refOrderId: order.id, operatorId, opId: randomUUID() },
          });
        }

        for (const productId of affectedProductIds) {
          await this.products.recomputeArchive(tx, productId);
        }
        return order;
      },
      { isolationLevel: "Serializable" }, // A2：关键写事务用 Serializable，彻底杜绝并发超卖
    );
  } catch (e: any) {
    // A1：捕获 unique 冲突，回查返回已存在单（幂等）
    if (e?.code === "P2002" && e?.meta?.target?.includes("opId")) {
      const existing = await this.prisma.saleOrder.findUnique({ where: { opId: input.opId }, include: { items: true } });
      if (existing) return existing;
    }
    throw e;
  }
}
```

> 注意：`editOrder`（:203-276）有同样的非原子问题，本 task 一并修。读 editOrder 当前实现，把它的库存增减也改成 `updateMany` 带条件。具体改法见 Step 3b。

- [ ] **Step 3b: 同步修 editOrder 的防超卖**

读 `sales.service.ts` 的 editOrder（约 :203-276），凡是 `tx.sku.update({ data: { stock: { decrement/increment } } })` 改为带条件的 `updateMany`：
- 减库存（用户加量或删行回滚反向）：`updateMany({ where: { id, stock: { gte: delta } }, data: { stock: { decrement: delta } } })`，count!==1 抛库存不足
- 加库存（用户减量或删行）：`updateMany({ where: { id }, data: { stock: { increment: delta } } })`

editOrder 的事务也加 `{ isolationLevel: "Serializable" }`。

- [ ] **Step 4: 运行并发测试验证通过**

Run: `cd E:/Project/cloth_scan; pnpm --filter @cloth-scan/server test:integration`
Expected: A1（同 opId 返回同一单、库存只扣一次）+ A2（不超卖）全 PASS。

- [ ] **Step 5: 跑原有 unit 测试确认无回归**

Run: `cd E:/Project/cloth_scan; pnpm --filter @cloth-scan/server test`
Expected: 原有 25 例仍 PASS（可能需调整 mock——因为 createSale 现在用 updateMany 而非 update，mock 的 sku.update 要改 sku.updateMany）。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/sales/sales.service.ts apps/server/src/sales/sales.service.integration-spec.ts apps/server/src/sales/sales.service.spec.ts
git commit -m "fix(sales): createSale 幂等竞态(P2002捕获) + 防超卖原子性(updateMany+Serializable)

A1: 移除 findUnique(opId) 预检查消除 TOCTOU，事务内 create 捕获 P2002 回查返回已存在单
A2: 防超卖改 updateMany 带 stock>=qty 条件+Serializable 隔离级别，杜绝并发超卖
editOrder 同步改为原子条件更新
新增并发集成测试（testcontainers 真实 PG）覆盖 A1/A2"
```

---

## Task 3: 订单物理删除改软删除（A4）

**Files:**
- Modify: `apps/server/src/sales/sales.service.ts`（deleteOrder 方法，约 :170-200）
- Modify: `apps/server/prisma/schema.prisma`（SaleOrder 加 deletedAt 字段）
- Create: `apps/server/prisma/migrations/<timestamp>_sale_soft_delete/migration.sql`
- Test: `apps/server/src/sales/sales.service.spec.ts` 或 integration-spec

**问题**：`deleteOrder` 直接 `saleOrder.delete`，误删单无法追溯。schema 已有 `SaleOrderStatus.voided` 却没用。

- [ ] **Step 1: schema 加 deletedAt + 生成迁移**

在 `apps/server/prisma/schema.prisma` 的 `SaleOrder` model 加：
```prisma
  /// 软删除时间戳（null = 未删除）。删除时置 voided 状态 + 此时间戳，保留审计痕迹
  deletedAt DateTime?
```

生成迁移：
```bash
cd E:/Project/cloth_scan
pnpm --filter @cloth-scan/server prisma:migrate -- --name sale_soft_delete --create-only
```
检查生成的 migration.sql 应是 `ALTER TABLE "SaleOrder" ADD COLUMN "deletedAt" TIMESTAMP(3);`

- [ ] **Step 2: 改 deleteOrder 为软删除**

`sales.service.ts` 的 deleteOrder（约 :170-200）：把 `tx.saleOrder.delete(...)` 改为：
```typescript
await tx.saleOrder.update({
  where: { id: orderId },
  data: { status: "voided", deletedAt: new Date() },
});
```
保留库存回滚 + 流水逻辑不变。删掉级联删 SaleItem（现在靠 voided + 查询过滤）。

- [ ] **Step 3: 所有查询过滤掉 voided/deletedAt 单**

检查 `sales.service.ts` 所有 `saleOrder.findMany`/`findUnique`（listOrders/report/monthlyReport 等），where 加 `status: "completed"`（多数已有，确认全覆盖）。listOrders 的 where 确保有 `deletedAt: null`（防止已删单出现在流水）。

- [ ] **Step 4: 写测试 + 跑**

在 integration-spec 加测试：删单后 status=voided、deletedAt 非空、库存已回滚、listOrders 不含该单。
Run: `pnpm --filter @cloth-scan/server test; pnpm --filter @cloth-scan/server test:integration`
Expected: 全 PASS。

- [ ] **Step 5: 部署迁移说明 + 提交**

迁移在生产由容器启动 `prisma migrate deploy` 自动跑（加列 nullable，不影响历史数据）。

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma/migrations/ apps/server/src/sales/sales.service.ts apps/server/src/sales/sales.service.integration-spec.ts
git commit -m "fix(sales): 订单删除改软删除（voided+deletedAt），保留审计痕迹

原 deleteOrder 物理删除，误删无法追溯。改用 schema 已有的 voided 状态 + 新增
deletedAt 时间戳。所有报表/流水查询过滤 status=completed + deletedAt=null。
迁移加 nullable 列，生产 deploy 自动跑，不影响历史数据。"
```

---

## Task 4: 订单级优惠字段（A3，解决整单优惠取整死角）

**Files:**
- Modify: `apps/server/prisma/schema.prisma`（SaleOrder 加 orderDiscountCents）
- Create: 迁移
- Modify: `packages/shared/src/sale.ts`（CreateSaleOrderInput 加 orderDiscountCents + SaleOrder/SaleOrderDetail 加）
- Modify: `apps/server/src/sales/sales.service.ts`（createSale 接收并存储 discount，totalAmount 改为"各行 subtotal 之和 - discount"）
- Modify: `packages/shared/src/cart.ts`（distributeOrderTotal 弃用或改为仅做参考分摊；cartToSaleInput 加 orderDiscountCents）
- Modify: `apps/mobile/src/screens/CashierScreen.tsx`（整单优惠不再调 distributeOrderTotal 分摊到行，而是把优惠金额作为订单字段提交）

**Interfaces:**
- Produces: `CreateSaleOrderInput.orderDiscountCents?: number`（整单优惠，分）；`SaleOrder.orderDiscountCents: number`（默认 0）

**背景**：Task 1（第 1 波）发现 distributeOrderTotal 在多件行整数分约束下无精确解（数学死角）。用户决策：加订单级优惠字段，各行按原价入库，优惠单独记。

- [ ] **Step 1: schema 加 orderDiscountCents + 迁移**

`schema.prisma` 的 SaleOrder 加：
```prisma
  /// 整单优惠金额（分，默认0）。各行按原价入库，订单实收 = Σ各行subtotal - orderDiscountCents
  orderDiscountCents Int @default(0)
```
迁移：`pnpm --filter @cloth-scan/server prisma:migrate -- --name sale_order_discount --create-only`
检查 SQL：`ALTER TABLE "SaleOrder" ADD COLUMN "orderDiscountCents" INTEGER NOT NULL DEFAULT 0;`

- [ ] **Step 2: shared 加字段**

`packages/shared/src/sale.ts`：
- `SaleOrderSchema` 加 `orderDiscountCents: Money.default(0)`
- `SaleOrderSchema` 的 totalAmount 注释改为"实收 = Σ各行subtotal - orderDiscountCents"
- `CreateSaleOrderInput` 加 `orderDiscountCents: Money.optional()`（留空=0）
- `SaleOrderDetail` interface 加 `orderDiscountCents: number`

`packages/shared/src/cart.ts`：
- `cartToSaleInput` 签名加 `orderDiscountCents?: number` 参数，写入输出的 orderDiscountCents
- `distributeOrderTotal` 保留但标 `@deprecated`，JSDoc 说明"新方案用订单级优惠字段，此函数仅用于 UI 显示各行参考价"

- [ ] **Step 3: build shared**

Run: `pnpm --filter @cloth-scan/shared build`

- [ ] **Step 4: 后端 createSale 接收 discount**

`sales.service.ts` createSale：`totalAmount` 计算改为 `total - (input.orderDiscountCents ?? 0)`；`order.create` 的 data 加 `orderDiscountCents: input.orderDiscountCents ?? 0`。

- [ ] **Step 5: 移动端 CashierScreen 改提交逻辑**

`CashierScreen.tsx` 的 doCheckout：不再调 `distributeOrderTotal(lines, target)` 分摊到行单价；改为：
- 各行 price 保持原价（议价单独改的 price 仍保留）
- 计算 `orderDiscountCents = cartTotalCents(lines) - targetTotal`（targetTotal 是用户输入的整单优惠后总价）
- `cartToSaleInput(lines, genOpId(), orderDiscountCents)` 提交

UI 显示：底部结算栏的"总价"显示 `targetTotal`（优惠后），明细各行仍显示原价。

- [ ] **Step 6: 报表逻辑确认**

`sales.service.ts` 的 report 利润计算：`profit = revenue - cost`，其中 `revenue` 应是实收（Σsubtotal - orderDiscountCents）。检查 report/monthlyReport 的 revenue 聚合是否用了 totalAmount（实收）而非 Σitems.price×qty（原价合计）。若有不一致，改用 totalAmount。

- [ ] **Step 7: 测试 + 提交**

补 unit/integration 测试：带 orderDiscountCents 开单、totalAmount 正确、报表 revenue 用实收。
Run: `pnpm --filter @cloth-scan/shared test; pnpm --filter @cloth-scan/server test; pnpm --filter @cloth-scan/mobile typecheck`

```bash
git add -A
git commit -m "feat(sale): 订单级优惠字段 orderDiscountCents，解决整单优惠取整死角

原 distributeOrderTotal 在多件行整数分约束下无精确解（数学死角）。改方案：
各行按原价入库，订单级单独记 orderDiscountCents，实收=Σ各行subtotal-discount。
totalAmount 即实收，报表 revenue/profit 基于实收计算。distributeOrderTotal
标 deprecated 仅作 UI 参考分摊。第1波 Task1 的 A3 由此彻底解决。"
```

---

## Task 5: 修同步引擎乐观扣与 pull 的竞态（D1）

**Files:**
- Modify: `apps/mobile/src/sync/sync.ts`（pullCatalog 时跳过 pending 涉及的 sku）
- Modify: `apps/mobile/src/db/catalog.ts`（加"按 skuId 批量保留"辅助）
- Modify: `apps/mobile/src/db/outbox.ts`（加 listPendingSkuIds 辅助）

**问题**：`doCheckout` 乐观扣本地库存，若 push 因网络错保留 pending 而 pull 先到，本地 stock 被服务端值覆盖导致"跳回"，短暂超卖窗口。

- [ ] **Step 1: 加 listPendingSkuIds 辅助**

`apps/mobile/src/db/outbox.ts` 加：
```typescript
/** 返回当前 pending（未同步）的 outbox 里所有涉及的 skuId（从 payload 解析） */
export async function listPendingSkuIds(db: SQLiteDatabase): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ payload: string }>(
    `SELECT payload FROM outbox WHERE status = 'pending'`,
  );
  const ids = new Set<string>();
  for (const r of rows) {
    try {
      const payload = JSON.parse(r.payload) as { items?: { skuId: string }[] };
      for (const it of payload.items ?? []) ids.add(it.skuId);
    } catch { /* 忽略损坏 payload */ }
  }
  return ids;
}
```

- [ ] **Step 2: pullCatalog 跳过 pending sku 的 stock 覆盖**

`apps/mobile/src/db/catalog.ts` 的 upsertCatalog（或 sync.ts 的 pullCatalog）改造：
- 接收 pendingSkuIds 参数
- 对 pendingSkuIds 里的 sku，upsert 时**不覆盖 stock 字段**（保留本地乐观值），其他字段（name/price/coverImage/updatedAt）正常更新

实现：upsertCatalog 的 INSERT OR REPLACE 改为先查本地现有 stock，对 pending sku 用本地旧 stock 值。或用 `UPDATE skus_cache SET name=?, price=?, ... WHERE barcode=? AND stock 保持不变`。

- [ ] **Step 3: sync.ts 的 syncAll 串联**

`apps/mobile/src/sync/sync.ts` 的 syncAll（约 :67-74）：pullCatalog 前先 `const pendingIds = await listPendingSkuIds(db)`，传给 upsertCatalog。

- [ ] **Step 4: typecheck + 提交**

```bash
cd E:/Project/cloth_scan
pnpm --filter @cloth-scan/mobile typecheck
git add apps/mobile/src/sync/ apps/mobile/src/db/
git commit -m "fix(sync): pull 时跳过 pending outbox 涉及 SKU 的 stock 覆盖，消除竞态

乐观扣本地库存后若 push 未成功而 pull 先到，原逻辑会用服务端 stock 覆盖本地
导致跳回/超卖窗口。改为 pull 时对 pending outbox 涉及的 skuId 保留本地 stock，
其他字段正常更新。push 成功后服务端已扣，下次 pull 覆盖为正确值。"
```

---

## Task 6: 对齐 shared SaleItemSchema 缺 cost（B1）

**Files:**
- Modify: `packages/shared/src/sale.ts:5-12`（SaleItemSchema 加 cost）
- Modify: `packages/shared/src/sale.ts` SaleItemDetail（评估是否对 owner 暴露 cost）

**问题**：shared `SaleItemSchema`（:5-12）无 cost，Prisma `SaleItem.cost` 是进价快照（PRD §7 规则 8 载体）。

- [ ] **Step 1: SaleItemSchema 加 cost**

`packages/shared/src/sale.ts:5-12`：
```typescript
export const SaleItemSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  skuId: z.string().uuid(),
  quantity: z.number().int().positive(),
  price: Money,
  cost: Money, // 进价快照（分），PRD §7 规则 8
  subtotal: Money,
});
```

- [ ] **Step 2: build + server typecheck（确认无破坏）**

Run: `pnpm --filter @cloth-scan/shared build; pnpm --filter @cloth-scan/server typecheck`
Expected: 若有地方构造 SaleItem 但没传 cost，typecheck 报错——逐一补 cost 字段。

- [ ] **Step 3: 提交**

```bash
git add packages/shared/src/sale.ts packages/shared/dist apps/server/src/
git commit -m "fix(shared): SaleItemSchema 加 cost 字段（进价快照），与 Prisma 对齐

原 shared SaleItem 缺 cost，PRD §7 规则 8（进价快照）在类型层无载体。
Prisma SaleItem.cost 是进价快照用于毛利计算，shared 现补齐 cost: Money。"
```

---

## Task 7: 对齐 shared ProductSchema 缺 deletedAt + 抽 shouldArchive 到 shared（B2 + B3）

**Files:**
- Modify: `packages/shared/src/product.ts`（ProductSchema 加 deletedAt；新增 shouldArchive 纯函数）
- Modify: `apps/server/src/products/products.service.ts`（recomputeArchive 调用 shared 的 shouldArchive）
- Test: `packages/shared/src/product.test.ts`（加 shouldArchive 用例）

**问题 B2**：ProductSchema（product.ts:24-35）无 deletedAt，软删除语义在 shared 不可见。
**问题 B3**：recomputeArchive（products.service.ts:261-285）的归档判定只在后端，前端无法复用。

- [ ] **Step 1: ProductSchema 加 deletedAt**

`packages/shared/src/product.ts` 的 ProductSchema 加：
```typescript
  deletedAt: z.string().datetime().nullable().optional(),
```

- [ ] **Step 2: 新增 shouldArchive 纯函数**

`packages/shared/src/product.ts` 末尾加：
```typescript
/**
 * 判断商品当前是否应处于「已归档/售罄」状态（PRD §7 规则 7）。
 * - 已删除（deletedAt 非空）→ 不复活，返回当前 archivedAt 状态
 * - 总库存 <= 0 且未归档 → 应归档
 * - 总库存 > 0 且已归档 → 应恢复
 * - 否则保持现状
 */
export function shouldArchive(opts: {
  totalStock: number;
  archivedAt: string | null;
  deletedAt: string | null;
}): string | null {
  if (opts.deletedAt) return opts.archivedAt; // 已删不复活
  if (opts.totalStock <= 0 && !opts.archivedAt) return new Date().toISOString(); // 售罄归档
  if (opts.totalStock > 0 && opts.archivedAt) return null; // 补货恢复
  return opts.archivedAt; // 保持
}
```

在 `index.ts` 确保导出（`export * from "./product"` 已含）。

- [ ] **Step 3: recomputeArchive 调用 shouldArchive**

`apps/server/src/products/products.service.ts` 的 recomputeArchive（约 :261-285）：把内联的归档判定逻辑替换为调用 shared 的 shouldArchive：
```typescript
import { shouldArchive } from "@cloth-scan/shared";
// ...
const newArchivedAt = shouldArchive({ totalStock, archivedAt, deletedAt });
if (newArchivedAt !== archivedAt) {
  await tx.product.update({ where: { id: productId }, data: { archivedAt: newArchivedAt } });
}
```

- [ ] **Step 4: 补单测 + build + 提交**

`packages/shared/src/product.test.ts` 加 shouldArchive 用例（售罄归档/补货恢复/已删不复活/保持现状）。
Run: `pnpm --filter @cloth-scan/shared build; pnpm --filter @cloth-scan/shared test; pnpm --filter @cloth-scan/server typecheck`

```bash
git add packages/shared/src/ apps/server/src/products/products.service.ts
git commit -m "fix(shared): ProductSchema 加 deletedAt + 抽 shouldArchive 纯函数

B2: ProductSchema 补 deletedAt（软删除字段），与 Prisma 对齐
B3: 售罄归档判定逻辑抽为 shared 纯函数 shouldArchive，后端调用，前端可复用
recomputeArchive 改调 shouldArchive，补单测覆盖四个分支"
```

---

## Self-Review

**1. Spec coverage（对照 REFACTOR-OPPORTUNITIES.md）**：
- A1（幂等 TOCTOU）→ Task 2 ✅
- A2（防超卖缺锁）→ Task 2 ✅
- A3（整单优惠取整）→ Task 4（订单级优惠字段）✅
- A4（订单物理删除）→ Task 3 ✅
- D1（同步竞态）→ Task 5 ✅
- B1（SaleItem 缺 cost）→ Task 6 ✅
- B2（Product 缺 deletedAt）→ Task 7 ✅
- B3（recomputeArchive 抽 shared）→ Task 7 ✅
- 测试基础设施 → Task 1 ✅

**2. 依赖链**：
- Task 1（testcontainers）必须最先，Task 2/3 的并发测试依赖它
- Task 2（A1/A2）依赖 Task 1
- Task 3（A4）与 Task 4（A3）都改 SaleOrder 模型，建议**连续做**（可合并迁移或顺序执行避免迁移冲突）
- Task 5（D1）独立
- Task 6（B1）独立
- Task 7（B2/B3）独立

**3. 风险点**：
- Task 2 的 createSale 改动大（updateMany 替代 update），原 unit 测试的 mock 需调整——已在 Step 5 标注
- Task 3 + Task 4 都改 schema，迁移文件时间戳顺序敏感，建议 Task 3 先于 Task 4（先加 deletedAt 再加 orderDiscountCents）
- Task 4 改动横跨 schema/shared/server/mobile，是最大的 task，建议拆成 server 侧 + mobile 侧两个提交
