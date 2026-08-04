import { describe, it, expect, vi } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SalesService } from "./sales.service";
import type { PrismaService } from "../prisma/prisma.service";

const SHOP = "shop-1";

/** products.recomputeArchive 是 SalesService 的依赖，此处 stub 掉避免拉起真实 Prisma */
const productsStub = { recomputeArchive: vi.fn() } as any;

/**
 * 构造 mock prisma。createSale 重写后流程：
 *   tx.sku.updateMany({ where:{ id, product:{shopId}, stock:{gte:qty} } }) → count===1 才扣减成功
 *   成功后再 tx.sku.findUnique() 取 costPrice/salePrice 快照
 *   失败（count!==1）再 tx.sku.findUnique() 回查给准确错误
 *   最后 tx.saleOrder.create({ ..., opId })，可能抛 P2002（被外层 catch 兜底回查）
 */
function makePrisma(opts: {
  sku?: any;
  updateManyCount?: number;
  saleOrderCreateThrows?: any;
  existingOrder?: any;
}) {
  const skuRow = opts.sku ?? null;
  const tx = {
    sku: {
      findUnique: vi.fn().mockResolvedValue(skuRow),
      updateMany: vi
        .fn()
        .mockResolvedValue({ count: opts.updateManyCount ?? 1 }),
    },
    saleOrder: {
      create: opts.saleOrderCreateThrows
        ? vi.fn().mockImplementation(() => {
            throw opts.saleOrderCreateThrows;
          })
        : vi.fn().mockImplementation(({ data }: any) => ({
            id: "order-1",
            ...data,
            items: data.items?.create ?? [],
          })),
    },
    stockMovement: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    saleOrder: {
      findUnique: vi.fn().mockResolvedValue(opts.existingOrder ?? null),
    },
    $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    __tx: tx,
  };
  return prisma as unknown as PrismaService & { __tx: typeof tx };
}

const okSku = {
  id: "sku-1",
  productId: "prod-1",
  barcode: "DEMO-WHITE-M",
  salePrice: 5900,
  costPrice: 3000,
  stock: 10,
  product: { shopId: SHOP },
};

describe("SalesService.createSale", () => {
  it("正常开单：原子扣减库存并写一条出库流水", async () => {
    const prisma = makePrisma({ sku: { ...okSku } }) as any;
    const service = new SalesService(prisma, productsStub);

    const order = await service.createSale(SHOP, "user-1", {
      opId: "op-1",
      items: [{ skuId: "sku-1", quantity: 2 }],
    });

    expect(order.totalAmount).toBe(5900 * 2);
    // 防超卖：用带 stock>=qty 条件的 updateMany 原子扣减
    expect(prisma.__tx.sku.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sku-1", product: { shopId: SHOP }, stock: { gte: 2 } },
        data: expect.objectContaining({
          stock: { decrement: 2 },
          version: { increment: 1 },
        }),
      }),
    );
    expect(prisma.__tx.stockMovement.create).toHaveBeenCalledTimes(1);
  });

  it("重复 opId：事务内 create 撞 P2002，回查返回已存在单（幂等）", async () => {
    // 模拟并发下 loser 跑到 create 撞 opId unique 约束
    const p2002 = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["opId"] },
    });
    const existing = { id: "order-existing", items: [] };
    const prisma = makePrisma({
      sku: { ...okSku },
      saleOrderCreateThrows: p2002,
      existingOrder: existing, // 外层 findUnique 回查命中已存在单
    }) as any;
    const service = new SalesService(prisma, productsStub);

    const order = await service.createSale(SHOP, "user-1", {
      opId: "op-1",
      items: [{ skuId: "sku-1", quantity: 1 }],
    });

    expect(order).toBe(existing);
    // 进入事务了（无外层预检查），P2002 被捕获后回查
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.saleOrder.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { opId: "op-1" } }),
    );
  });

  it("并发序列化冲突 P2034 且已有同 opId 单：回查返回已存在单（幂等）", async () => {
    // Serializable 隔离下 loser 可能在 updateMany 阶段被 PG 中止（P2034）
    const p2034 = Object.assign(
      new Error("Transaction failed due to a write conflict or a deadlock"),
      { code: "P2034" },
    );
    const existing = { id: "order-existing", items: [] };
    const prisma = makePrisma({
      sku: { ...okSku },
      updateManyCount: 0, // 触发 $transaction reject（这里手动构造 reject 路径）
      existingOrder: existing,
    }) as any;
    // 让 $transaction 抛 P2034（模拟 PG 中止整个事务）
    prisma.$transaction = vi.fn().mockRejectedValue(p2034);
    const service = new SalesService(prisma, productsStub);

    const order = await service.createSale(SHOP, "user-1", {
      opId: "op-race",
      items: [{ skuId: "sku-1", quantity: 1 }],
    });

    expect(order).toBe(existing);
    expect(prisma.saleOrder.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { opId: "op-race" } }),
    );
  });

  it("库存不足：updateMany count=0，回查后抛 BadRequestException", async () => {
    const prisma = makePrisma({
      sku: { ...okSku, stock: 1 },
      updateManyCount: 0, // 库存 1 < 需 5，updateMany 不命中
    }) as any;
    const service = new SalesService(prisma, productsStub);

    await expect(
      service.createSale(SHOP, "user-1", {
        opId: "op-2",
        items: [{ skuId: "sku-1", quantity: 5 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.__tx.sku.updateMany).toHaveBeenCalled();
  });

  it("跨店 SKU：updateMany 因 product.shopId 过滤不命中，回查后抛 NotFoundException", async () => {
    const prisma = makePrisma({
      sku: { ...okSku, product: { shopId: "other-shop" } },
      updateManyCount: 0, // 门店隔离过滤使 updateMany 不命中
    }) as any;
    const service = new SalesService(prisma, productsStub);

    await expect(
      service.createSale(SHOP, "user-1", {
        opId: "op-3",
        items: [{ skuId: "sku-1", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("SalesService.getSummary", () => {
  it("????/???????????????", async () => {
    const prisma = {
      saleOrder: {
        aggregate: vi
          .fn()
          .mockResolvedValueOnce({ _sum: { totalAmount: 11800 }, _count: 2 })
          .mockResolvedValueOnce({ _sum: { totalAmount: 30000 }, _count: 5 })
          .mockResolvedValueOnce({ _sum: { totalAmount: 88000 }, _count: 12 }),
      },
      saleItem: {
        aggregate: vi
          .fn()
          .mockResolvedValueOnce({ _sum: { quantity: 3 } })
          .mockResolvedValueOnce({ _sum: { quantity: 8 } })
          .mockResolvedValueOnce({ _sum: { quantity: 20 } }),
        groupBy: vi
          .fn()
          .mockResolvedValue([
            { skuId: "sku-1", _sum: { quantity: 5, subtotal: 29500 } },
          ]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "sku-1",
            color: "?",
            size: "M",
            barcode: "DEMO-WHITE-M",
            product: { name: "??T?" },
          },
        ]),
      },
    } as any;
    const service = new SalesService(prisma, productsStub);

    const summary = await service.getSummary(SHOP);

    expect(summary.today).toEqual({ revenue: 11800, orders: 2, quantity: 3 });
    expect(summary.week).toEqual({ revenue: 30000, orders: 5, quantity: 8 });
    expect(summary.month).toEqual({ revenue: 88000, orders: 12, quantity: 20 });
    expect(summary.topSkus).toHaveLength(1);
    expect(summary.topSkus[0]).toMatchObject({
      productName: "??T?",
      quantity: 5,
      revenue: 29500,
    });
  });

  it("??????????????", async () => {
    const prisma = {
      saleOrder: {
        aggregate: vi
          .fn()
          .mockResolvedValue({ _sum: { totalAmount: null }, _count: 0 }),
      },
      saleItem: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: null } }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      sku: { findMany: vi.fn() },
    } as any;
    const service = new SalesService(prisma, productsStub);

    const summary = await service.getSummary(SHOP);

    expect(summary.today).toEqual({ revenue: 0, orders: 0, quantity: 0 });
    expect(summary.topSkus).toEqual([]);
    expect(prisma.sku.findMany).not.toHaveBeenCalled();
  });
});

describe("SalesService.report", () => {
  it("利润 = 营业额 - 进价快照×数量（今日档，无下钻桶）", async () => {
    const prisma = {
      saleOrder: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "order-1",
            totalAmount: 11800,
            createdAt: new Date(),
            items: [{ quantity: 2, price: 5900, cost: 3000, subtotal: 11800 }],
          },
        ]),
      },
      saleItem: { groupBy: vi.fn().mockResolvedValue([]) },
      sku: { findMany: vi.fn() },
    } as any;
    const service = new SalesService(prisma, productsStub);

    const report = await service.report(SHOP, "today");

    expect(report.total).toEqual({
      revenue: 11800,
      cost: 6000,
      profit: 5800,
      orders: 1,
      quantity: 2,
    });
    expect(report.buckets).toEqual([]);
    expect(report.topSkus).toEqual([]);
  });
});

describe("SalesService.deleteOrder", () => {
  it("整单软删除：库存加回 + 删出库流水 + 单据置 voided/deletedAt（不级联删 SaleItem）", async () => {
    const tx = {
      sku: { update: vi.fn().mockResolvedValue({ productId: "p1" }) },
      stockMovement: { deleteMany: vi.fn().mockResolvedValue({}) },
      saleOrder: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      saleOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: "o1",
          shopId: SHOP,
          status: "completed",
          deletedAt: null,
          items: [{ skuId: "s1", quantity: 2 }],
        }),
      },
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    } as any;
    const service = new SalesService(prisma, productsStub);

    const res = await service.deleteOrder(SHOP, "o1");

    expect(res).toEqual({ ok: true });
    expect(tx.sku.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: expect.objectContaining({ stock: { increment: 2 } }),
      }),
    );
    expect(tx.stockMovement.deleteMany).toHaveBeenCalledWith({
      where: { refOrderId: "o1" },
    });
    // 软删除：update 置 voided + deletedAt，不再物理 delete
    expect(tx.saleOrder.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { status: "voided", deletedAt: expect.any(Date) },
    });
    expect((tx.saleOrder as any).delete).toBeUndefined();
  });
});

describe("SalesService.editOrder", () => {
  it("减少数量会回滚库存并重算总价", async () => {
    const editable = {
      id: "o1",
      shopId: SHOP,
      items: [
        {
          id: "i1",
          skuId: "s1",
          quantity: 2,
          price: 5000,
          subtotal: 10000,
          sku: { id: "s1", productId: "p1", stock: 3, barcode: "B" },
        },
      ],
    };
    const detail = {
      id: "o1",
      shopId: SHOP,
      operatorId: null,
      operator: null,
      status: "completed",
      deletedAt: null,
      totalAmount: 5000,
      createdAt: new Date(),
      items: [
        {
          id: "i1",
          skuId: "s1",
          quantity: 1,
          price: 5000,
          subtotal: 5000,
          sku: {
            color: "白",
            size: "M",
            barcode: "B",
            product: { name: "T恤", coverImage: null },
          },
        },
      ],
    };
    const tx = {
      sku: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      stockMovement: { create: vi.fn().mockResolvedValue({}) },
      saleItem: {
        delete: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ subtotal: 5000 }]),
      },
      saleOrder: { update: vi.fn().mockResolvedValue({}), delete: vi.fn() },
    };
    const prisma = {
      saleOrder: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(editable)
          .mockResolvedValueOnce(detail),
      },
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    } as any;
    const service = new SalesService(prisma, productsStub);

    const result = await service.editOrder(SHOP, "o1", {
      items: [{ id: "i1", quantity: 1, price: 5000 }],
    });

    // 数量 2→1：delta=-1 < 0，加库存走原子 updateMany，count===1
    expect(tx.sku.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1", product: { shopId: SHOP } },
        data: expect.objectContaining({
          stock: { increment: 1 },
          version: { increment: 1 },
        }),
      }),
    );
    expect(tx.saleItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "i1" },
        data: expect.objectContaining({ quantity: 1, subtotal: 5000 }),
      }),
    );
    expect(tx.saleOrder.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { totalAmount: 5000 },
    });
    expect(result.totalAmount).toBe(5000);
  });
});

describe("SalesService.getOrder", () => {
  const orderRow = {
    id: "order-1",
    shopId: SHOP,
    operatorId: "user-1",
    operator: { name: "??" },
    status: "completed",
    deletedAt: null,
    totalAmount: 11800,
    createdAt: new Date("2026-06-08T10:00:00.000Z"),
    items: [
      {
        id: "it-1",
        skuId: "sku-1",
        quantity: 2,
        price: 5900,
        subtotal: 11800,
        sku: {
          color: "?",
          size: "M",
          barcode: "DEMO-WHITE-M",
          product: { name: "??T?", coverImage: null },
        },
      },
    ],
  };

  it("????????????????????", async () => {
    const prisma = {
      saleOrder: { findUnique: vi.fn().mockResolvedValue(orderRow) },
    } as any;
    const service = new SalesService(prisma, productsStub);

    const detail = await service.getOrder(SHOP, "order-1");

    expect(detail.operatorName).toBe("??");
    expect(detail.itemCount).toBe(2);
    expect(detail.items[0]).toMatchObject({
      productName: "??T?",
      color: "?",
      size: "M",
    });
  });

  it("?????? NotFoundException", async () => {
    const prisma = {
      saleOrder: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ ...orderRow, shopId: "other-shop" }),
      },
    } as any;
    const service = new SalesService(prisma, productsStub);

    await expect(service.getOrder(SHOP, "order-1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("软删单（voided + deletedAt 非空）视为不存在，抛 NotFoundException", async () => {
    const prisma = {
      saleOrder: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ ...orderRow, status: "voided", deletedAt: new Date() }),
      },
    } as any;
    const service = new SalesService(prisma, productsStub);

    await expect(service.getOrder(SHOP, "order-1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
