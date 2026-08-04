import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { startPg, stopPg, resetDb } from "../../test/pg-container";
import { SalesService } from "./sales.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProductsService } from "../products/products.service";

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

/**
 * 并发安全测试（Task 2: A1 幂等 + A2 防超卖）。
 * 用独立 describe 块 + 自己的 beforeAll/afterAll，避免与上面的基础设施冒烟测试
 * 共享同一 prisma 单例导致 resetDb 互相干扰。
 */
async function seedFixture(p: PrismaClient) {
  await resetDb(p);
  const shop = await p.shop.create({ data: { name: "并发测试店" } });
  const user = await p.user.create({
    data: {
      shopId: shop.id,
      name: "测试店主",
      phone: "13900000000",
      passwordHash: "x",
      role: "owner",
    },
  });
  const product = await p.product.create({
    data: { shopId: shop.id, name: "测试款", coverImage: null },
  });
  const sku = await p.sku.create({
    data: {
      productId: product.id,
      barcode: "CONC-001",
      color: "默认",
      size: "均",
      costPrice: 5000,
      salePrice: 9900,
      stock: 10,
      version: 0,
    },
  });
  // 初始库存流水
  await p.stockMovement.create({
    data: { skuId: sku.id, type: "in", quantity: 10, opId: "seed-in" },
  });
  return { shopId: shop.id, userId: user.id, skuId: sku.id };
}

describe("createSale 并发安全（A1 幂等 + A2 防超卖）", () => {
  let prisma: PrismaClient;
  let sales: SalesService;
  beforeAll(async () => {
    prisma = await startPg();
    sales = new SalesService(
      prisma as unknown as PrismaService,
      new ProductsService(prisma as unknown as PrismaService),
    );
  });
  afterAll(async () => { await stopPg(); });

  it("A1: 同一 opId 并发提交两次，只扣一次库存且都返回同一单", async () => {
    const { shopId, userId, skuId } = await seedFixture(prisma);
    const input = {
      opId: "op-concurrent-1",
      items: [{ skuId, quantity: 3, price: 9900 }],
    };
    const [r1, r2] = await Promise.all([
      sales.createSale(shopId, userId, input),
      sales.createSale(shopId, userId, input),
    ]);
    expect(r1.id).toBe(r2.id); // 同一单
    const sku = await prisma.sku.findUnique({ where: { id: skuId } });
    expect(sku!.stock).toBe(7); // 10 - 3，只扣一次
  });

  it("A2: 并发各买剩余全部库存，不应超卖（stock 不得为负）", async () => {
    const { shopId, userId, skuId } = await seedFixture(prisma);
    // 库存 10，两个请求各买 8（合计 16 > 10），应一个成功一个失败
    const results = await Promise.allSettled([
      sales.createSale(shopId, userId, {
        opId: "op-race-a",
        items: [{ skuId, quantity: 8, price: 9900 }],
      }),
      sales.createSale(shopId, userId, {
        opId: "op-race-b",
        items: [{ skuId, quantity: 8, price: 9900 }],
      }),
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

/**
 * Task 3: 订单软删除（A4）。删单 = voided + deletedAt，库存回滚，
 * SaleItem 行保留作审计痕迹，前台查询过滤掉软删单。
 */
describe("deleteOrder 软删除（A4）", () => {
  let prisma: PrismaClient;
  let sales: SalesService;
  beforeAll(async () => {
    prisma = await startPg();
    sales = new SalesService(
      prisma as unknown as PrismaService,
      new ProductsService(prisma as unknown as PrismaService),
    );
  });
  afterAll(async () => { await stopPg(); });

  it("删单后：status=voided、deletedAt 非空、库存回滚、SaleItem 保留", async () => {
    const { shopId, userId, skuId } = await seedFixture(prisma);
    // 开一笔单卖 4 件（库存 10 → 6）
    const order = await sales.createSale(shopId, userId, {
      opId: "op-softdel-1",
      items: [{ skuId, quantity: 4, price: 9900 }],
    });
    let sku = await prisma.sku.findUnique({ where: { id: skuId } });
    expect(sku!.stock).toBe(6); // 10 - 4

    // 记下明细 id 用于后续验证保留
    const itemIds = order.items.map((it) => it.id);
    expect(itemIds.length).toBe(1);

    // 软删除
    await sales.deleteOrder(shopId, order.id);

    // 单据仍在 DB，但 status=voided + deletedAt 非空
    const after = await prisma.saleOrder.findUnique({ where: { id: order.id } });
    expect(after).not.toBeNull();
    expect(after!.status).toBe("voided");
    expect(after!.deletedAt).not.toBeNull();
    expect(after!.deletedAt instanceof Date).toBe(true);

    // 库存回滚回 seed 水平（10）
    sku = await prisma.sku.findUnique({ where: { id: skuId } });
    expect(sku!.stock).toBe(10);

    // SaleItem 行仍存在（软删不级联删明细）
    const remainingItems = await prisma.saleItem.findMany({
      where: { orderId: order.id },
    });
    expect(remainingItems.length).toBe(1);
    expect(remainingItems.map((it) => it.id)).toEqual(itemIds);
  });

  it("listOrders 不含软删单", async () => {
    const { shopId, userId, skuId } = await seedFixture(prisma);
    const live = await sales.createSale(shopId, userId, {
      opId: "op-softdel-live",
      items: [{ skuId, quantity: 1, price: 9900 }],
    });
    const toDelete = await sales.createSale(shopId, userId, {
      opId: "op-softdel-del",
      items: [{ skuId, quantity: 1, price: 9900 }],
    });
    await sales.deleteOrder(shopId, toDelete.id);

    const list = await sales.listOrders(shopId);
    const ids = list.map((o) => o.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(toDelete.id); // 软删单对流水不可见
  });
});
