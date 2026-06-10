import { describe, it, expect, vi } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SalesService } from "./sales.service";
import type { PrismaService } from "../prisma/prisma.service";

const SHOP = "shop-1";

/** ???????? products.recomputeArchive???????????? */
const productsStub = { recomputeArchive: vi.fn() } as any;

function makePrisma(opts: { existingOrder?: any; sku?: any }) {
  const tx = {
    sku: {
      findUnique: vi.fn().mockResolvedValue(opts.sku ?? null),
      update: vi.fn().mockResolvedValue({}),
    },
    saleOrder: {
      create: vi.fn().mockImplementation(({ data }: any) => ({
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
  stock: 10,
  product: { shopId: SHOP },
};

describe("SalesService.createSale", () => {
  it("???????????????", async () => {
    const prisma = makePrisma({ sku: { ...okSku } }) as any;
    const service = new SalesService(prisma, productsStub);

    const order = await service.createSale(SHOP, "user-1", {
      opId: "op-1",
      items: [{ skuId: "sku-1", quantity: 2 }],
    });

    expect(order.totalAmount).toBe(5900 * 2);
    expect(prisma.__tx.sku.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sku-1" },
        data: expect.objectContaining({ stock: { decrement: 2 } }),
      }),
    );
    expect(prisma.__tx.stockMovement.create).toHaveBeenCalledTimes(1);
  });

  it("????? opId ??????????????", async () => {
    const existing = { id: "order-existing", items: [] };
    const prisma = makePrisma({ existingOrder: existing }) as any;
    const service = new SalesService(prisma, productsStub);

    const order = await service.createSale(SHOP, "user-1", {
      opId: "op-1",
      items: [{ skuId: "sku-1", quantity: 1 }],
    });

    expect(order).toBe(existing);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("???????? BadRequestException", async () => {
    const prisma = makePrisma({ sku: { ...okSku, stock: 1 } }) as any;
    const service = new SalesService(prisma, productsStub);

    await expect(
      service.createSale(SHOP, "user-1", {
        opId: "op-2",
        items: [{ skuId: "sku-1", quantity: 5 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("???SKU ??????? NotFoundException", async () => {
    const prisma = makePrisma({
      sku: { ...okSku, product: { shopId: "other-shop" } },
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

describe("SalesService.getOrder", () => {
  const orderRow = {
    id: "order-1",
    shopId: SHOP,
    operatorId: "user-1",
    operator: { name: "??" },
    status: "completed",
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
});
