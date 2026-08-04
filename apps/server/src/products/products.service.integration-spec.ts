import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { startPg, stopPg, resetDb } from "../../test/pg-container";
import { PrismaService } from "../prisma/prisma.service";
import { ProductsService } from "./products.service";

/**
 * Task 3 (D2 + D3): 增量同步 listProductsForSync 的集成测试。
 *
 * 验证三点：
 * - 首次同步（since 缺省）返回全量在售商品，deletedBarcodes 为空
 * - 增量同步（since=上次 serverTime）仅返回此后 updatedAt 变更的商品
 * - 被软删商品的 SKU 条码出现在 deletedBarcodes 中（供客户端清理缓存）
 *
 * 用 testcontainers PG + 真实 Prisma（不 mock），确保 where 子句语义正确。
 */

async function seedShop(p: PrismaClient, name = "同步测试店") {
  return p.shop.create({ data: { name } });
}

async function seedProduct(
  p: PrismaClient,
  shopId: string,
  opts: {
    name: string;
    barcode: string;
    archivedAt?: Date | null;
    costPrice?: number;
    salePrice?: number;
    stock?: number;
  },
) {
  const product = await p.product.create({
    data: {
      shopId,
      name: opts.name,
      archivedAt: opts.archivedAt ?? null,
    },
  });
  const sku = await p.sku.create({
    data: {
      productId: product.id,
      barcode: opts.barcode,
      color: "默认",
      size: "均",
      costPrice: opts.costPrice ?? 2000,
      salePrice: opts.salePrice ?? 5900,
      stock: opts.stock ?? 10,
      version: 0,
    },
  });
  return { product, sku };
}

describe("listProductsForSync 增量同步（D2 + D3）", () => {
  let prisma: PrismaClient;
  let service: ProductsService;

  beforeAll(async () => {
    prisma = await startPg();
    service = new ProductsService(prisma as unknown as PrismaService);
  });
  afterAll(async () => {
    await stopPg();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("首次同步（since 缺省）：返回全量在售商品，deletedBarcodes 为空", async () => {
    const shop = await seedShop(prisma);
    await seedProduct(prisma, shop.id, {
      name: "T恤",
      barcode: "0000000001",
    });
    await seedProduct(prisma, shop.id, {
      name: "牛仔裤",
      barcode: "0000000002",
      archivedAt: new Date(), // 已下架但仍要在同步里
    });

    const res = await service.listProductsForSync(shop.id);

    expect(res.products).toHaveLength(2);
    expect(res.deletedBarcodes).toEqual([]);
    expect(res.serverTime).toBeTruthy();
    // 已下架商品也应包含（sync 不按 archivedAt 过滤）
    const names = res.products.map((p) => p.name).sort();
    expect(names).toEqual(["T恤", "牛仔裤"]);
    // 每个 product 都带 skus
    expect(res.products[0]!.skus.length).toBeGreaterThan(0);
  });

  it("增量同步：仅返回 since 之后 updatedAt 变更的商品", async () => {
    const shop = await seedShop(prisma);
    const { sku: oldSku } = await seedProduct(prisma, shop.id, {
      name: "旧款",
      barcode: "0000000010",
    });

    // 第一次同步，拿 serverTime
    const first = await service.listProductsForSync(shop.id);
    expect(first.products).toHaveLength(1);
    const since = first.serverTime;

    // 等 50ms 确保 updatedAt > since（Prisma updatedAt 精度到毫秒）
    await new Promise((r) => setTimeout(r, 50));

    // 新增一个款（updatedAt 是 now，> since）
    await seedProduct(prisma, shop.id, {
      name: "新款",
      barcode: "0000000011",
    });
    // 改老款的名称触发 product.updatedAt 刷新（> since）
    await prisma.product.update({
      where: { id: oldSku.productId },
      data: { name: "旧款改名" },
    });

    const res = await service.listProductsForSync(shop.id, new Date(since));
    // 增量返回 product.updatedAt > since 的：改名老款 + 新增款 = 2 条
    const names = res.products.map((p) => p.name).sort();
    expect(names).toEqual(["新款", "旧款改名"]);
  });

  it("D3: 软删商品的 SKU 条码出现在 deletedBarcodes", async () => {
    const shop = await seedShop(prisma);
    // 软删要求先 archivedAt，所以直接构造 deletedAt 非空的 Product（绕开 service 的前置校验）
    const { product: toDelete, sku: deletedSku } = await seedProduct(prisma, shop.id, {
      name: "将删除",
      barcode: "0000000020",
      archivedAt: new Date(),
    });
    await seedProduct(prisma, shop.id, {
      name: "保留",
      barcode: "0000000021",
    });

    // 第一次同步拿到基线 serverTime
    const first = await service.listProductsForSync(shop.id);
    const since = first.serverTime;
    await new Promise((r) => setTimeout(r, 50));

    // 软删：置 deletedAt（模拟 deleteProduct 的副作用；product.updatedAt 自动刷新）
    await prisma.product.update({
      where: { id: toDelete.id },
      data: { deletedAt: new Date() },
    });

    const res = await service.listProductsForSync(shop.id, new Date(since));

    // 增量商品里不含软删的款（products 只查 deletedAt: null）
    expect(res.products).toHaveLength(0);
    // deletedBarcodes 含被软删款的 SKU 条码
    expect(res.deletedBarcodes).toContain(deletedSku.barcode);
    expect(res.deletedBarcodes).not.toContain("0000000021");
  });

  it("门店隔离：不返回其他门店的商品或删除", async () => {
    const shopA = await seedShop(prisma, "A店");
    const shopB = await seedShop(prisma, "B店");
    await seedProduct(prisma, shopB.id, {
      name: "B店款",
      barcode: "0000000030",
    });
    const { product: bDeleted } = await seedProduct(prisma, shopB.id, {
      name: "B店删除",
      barcode: "0000000031",
      archivedAt: new Date(),
    });
    await prisma.product.update({
      where: { id: bDeleted.id },
      data: { deletedAt: new Date() },
    });

    const res = await service.listProductsForSync(shopA.id);
    expect(res.products).toEqual([]);
    expect(res.deletedBarcodes).toEqual([]);
  });

  it("serverTime 为合法 ISO8601，可作为下次 since", async () => {
    const shop = await seedShop(prisma);
    const res = await service.listProductsForSync(shop.id);
    const d = new Date(res.serverTime);
    expect(Number.isNaN(d.getTime())).toBe(false);
    // 用它作为下次 since 不应抛
    const again = await service.listProductsForSync(shop.id, d);
    expect(again.serverTime).toBeTruthy();
  });
});
