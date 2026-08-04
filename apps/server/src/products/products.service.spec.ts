import { describe, it, expect, vi } from "vitest";
import { ProductsService } from "./products.service";
import type { PrismaService } from "../prisma/prisma.service";

const SHOP = "shop-1";

function makeUpdatePrisma(product: any, aggStock: number) {
  const tx = {
    product: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ archivedAt: null }),
    },
    sku: {
      update: vi.fn().mockResolvedValue({}),
      aggregate: vi.fn().mockResolvedValue({ _sum: { stock: aggStock } }),
    },
    stockMovement: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    product: {
      findUnique: vi.fn().mockResolvedValue(product),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    __tx: tx,
  };
  return prisma as unknown as PrismaService & { __tx: typeof tx };
}

const baseProduct = {
  id: "p1",
  shopId: SHOP,
  skus: [{ id: "s1", stock: 5, salePrice: 5900, costPrice: 2000 }],
};

describe("ProductsService.seedDemo", () => {
  it("空门店：灌入 3 个演示商品", async () => {
    const create = vi.fn().mockImplementation(({ data }: any) => ({
      id: "p",
      ...data,
      skus: [],
    }));
    const prisma = {
      product: {
        count: vi.fn().mockResolvedValue(0),
        create,
      },
      // generateUniqueBarcodes 调用 sku.findMany 查重，空门店返回空数组（条码均未占用）
      sku: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const service = new ProductsService(prisma);

    const res = await service.seedDemo(SHOP);

    expect(res.created).toBe(3);
    expect(create).toHaveBeenCalledTimes(3);
    // 每个 demo 商品都批量展开了多个 SKU
    const firstArg = (create as any).mock.calls[0][0];
    expect(firstArg.data.skus.create.length).toBeGreaterThan(1);
  });

  it("已有商品：幂等不重复灌入，created=0", async () => {
    const create = vi.fn();
    const prisma = {
      product: {
        count: vi.fn().mockResolvedValue(5),
        create,
      },
    } as unknown as PrismaService;
    const service = new ProductsService(prisma);

    const res = await service.seedDemo(SHOP);

    expect(res.created).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("ProductsService.updateProduct", () => {
  it("仅改价：更新售价、不产生库存流水、不触发归档", async () => {
    const prisma = makeUpdatePrisma({ ...baseProduct }, 5) as any;
    const service = new ProductsService(prisma);

    await service.updateProduct(SHOP, "p1", {
      skus: [{ id: "s1", salePrice: 6900 }],
    });

    expect(prisma.__tx.sku.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: expect.objectContaining({ salePrice: 6900 }),
      }),
    );
    expect(prisma.__tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it("盘点改库存为 0：写 adjust 流水并自动归档", async () => {
    const prisma = makeUpdatePrisma({ ...baseProduct }, 0) as any;
    const service = new ProductsService(prisma);

    await service.updateProduct(SHOP, "p1", {
      skus: [{ id: "s1", stock: 0 }],
    });

    // 差额 0-5 = -5 的 adjust 流水
    expect(prisma.__tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "adjust", quantity: -5 }),
      }),
    );
    // 总库存 0 -> 自动归档（archivedAt 被设置）
    const archiveCall = prisma.__tx.product.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.archivedAt instanceof Date,
    );
    expect(archiveCall).toBeTruthy();
  });

  it("跨门店编辑抛 NotFoundException", async () => {
    const prisma = makeUpdatePrisma(
      { ...baseProduct, shopId: "other" },
      5,
    ) as any;
    const service = new ProductsService(prisma);
    await expect(
      service.updateProduct(SHOP, "p1", { name: "x" }),
    ).rejects.toThrow();
  });
});

describe("ProductsService.setArchived", () => {
  it("手动下架设置 archivedAt", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      product: {
        findUnique: vi.fn().mockResolvedValue({ id: "p1", shopId: SHOP }),
        update,
      },
    } as unknown as PrismaService;
    const service = new ProductsService(prisma);

    await service.setArchived(SHOP, "p1", true);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      }),
    );
  });

  it("恢复在售设置 archivedAt=null", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      product: {
        findUnique: vi.fn().mockResolvedValue({ id: "p1", shopId: SHOP }),
        update,
      },
    } as unknown as PrismaService;
    const service = new ProductsService(prisma);

    await service.setArchived(SHOP, "p1", false);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { archivedAt: null } }),
    );
  });
});
