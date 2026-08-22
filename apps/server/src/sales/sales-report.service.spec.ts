import { describe, it, expect, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { SalesReportService } from "./sales-report.service";

const SHOP = "shop-1";

describe("SalesReportService.getSummary", () => {
  it("今日/本周/本月窗口：聚合下推 DB（aggregate + groupBy），返回热销榜", async () => {
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
          .mockResolvedValue([{ skuId: "sku-1", _sum: { quantity: 5, subtotal: 29500 } }]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "sku-1",
            color: "白",
            size: "M",
            barcode: "DEMO-WHITE-M",
            product: { name: "纯棉T恤" },
          },
        ]),
      },
    } as any;
    const service = new SalesReportService(prisma);

    const summary = await service.getSummary(SHOP);

    expect(summary.today).toEqual({ revenue: 11800, orders: 2, quantity: 3 });
    expect(summary.week).toEqual({ revenue: 30000, orders: 5, quantity: 8 });
    expect(summary.month).toEqual({ revenue: 88000, orders: 12, quantity: 20 });
    expect(summary.topSkus).toHaveLength(1);
    expect(summary.topSkus[0]).toMatchObject({
      productName: "纯棉T恤",
      quantity: 5,
      revenue: 29500,
    });
  });

  it("空数据：aggregate 返回 null/0，热销榜为空，不回查 sku", async () => {
    const prisma = {
      saleOrder: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: null }, _count: 0 }),
      },
      saleItem: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: null } }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      sku: { findMany: vi.fn() },
    } as any;
    const service = new SalesReportService(prisma);

    const summary = await service.getSummary(SHOP);

    expect(summary.today).toEqual({ revenue: 0, orders: 0, quantity: 0 });
    expect(summary.topSkus).toEqual([]);
    expect(prisma.sku.findMany).not.toHaveBeenCalled();
  });
});

describe("SalesReportService.getTodayHeadline", () => {
  it("只返回今日营业额与单数，不查热销", async () => {
    const prisma = {
      saleOrder: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: 5900 }, _count: 1 }),
      },
      saleItem: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 2 } }),
        groupBy: vi.fn(),
      },
      sku: { findMany: vi.fn() },
    } as any;
    const service = new SalesReportService(prisma);

    const today = await service.getTodayHeadline(SHOP);

    expect(today).toEqual({ revenue: 5900, orders: 1 });
    expect(prisma.saleItem.groupBy).not.toHaveBeenCalled();
    expect(prisma.sku.findMany).not.toHaveBeenCalled();
  });
});

describe("SalesReportService.report", () => {
  it("利润 = 营业额 - 进价快照×数量（今日档，无下钻桶；合计下推 DB aggregate）", async () => {
    // 今日档 report 调用序列：
    //  1) saleOrder.aggregate（收入+单数）
    //  2) saleItem.aggregate（销量）
    //  3) saleItem.groupBy（topSkus，返回空）
    //  4) saleOrder.groupBy（byOperator，返回空 → byOperator=[]）
    //  5) saleItem.findMany（sumCost，取 cost×quantity）
    // 今日档不拉日期桶（bucketRows = []）
    const prisma = {
      saleOrder: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { totalAmount: 11800 },
          _count: 1,
        }),
        groupBy: vi.fn().mockResolvedValue([]), // byOperator 空集
      },
      saleItem: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 2 } }),
        groupBy: vi.fn().mockResolvedValue([]), // topSkus 空集
        findMany: vi.fn().mockResolvedValue([{ cost: 3000, quantity: 2 }]), // sumCost
      },
      sku: { findMany: vi.fn() },
      user: { findMany: vi.fn() },
    } as any;
    const service = new SalesReportService(prisma);

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
    expect(report.byOperator).toEqual([]);
  });
});

describe("SalesReportService.getOrder", () => {
  const orderRow = {
    id: "order-1",
    shopId: SHOP,
    operatorId: "user-1",
    operator: { name: "张三" },
    status: "completed",
    deletedAt: null,
    totalAmount: 11800,
    orderDiscountCents: 0,
    createdAt: new Date("2026-06-08T10:00:00.000Z"),
    items: [
      {
        id: "it-1",
        skuId: "sku-1",
        quantity: 2,
        price: 5900,
        cost: 3000,
        subtotal: 11800,
        sku: {
          color: "白",
          size: "M",
          barcode: "DEMO-WHITE-M",
          product: { name: "纯棉T恤", coverImage: null },
        },
      },
    ],
  };

  it("返回详情：含操作人名、件数、商品名/颜色/尺码", async () => {
    const prisma = {
      saleOrder: { findUnique: vi.fn().mockResolvedValue(orderRow) },
    } as any;
    const service = new SalesReportService(prisma);

    const detail = await service.getOrder(SHOP, "order-1");

    expect(detail.operatorName).toBe("张三");
    expect(detail.itemCount).toBe(2);
    expect(detail.items[0]).toMatchObject({
      productName: "纯棉T恤",
      color: "白",
      size: "M",
    });
  });

  it("跨店单据抛 NotFoundException", async () => {
    const prisma = {
      saleOrder: {
        findUnique: vi.fn().mockResolvedValue({ ...orderRow, shopId: "other-shop" }),
      },
    } as any;
    const service = new SalesReportService(prisma);

    await expect(service.getOrder(SHOP, "order-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("软删单（voided + deletedAt 非空）视为不存在，抛 NotFoundException", async () => {
    const prisma = {
      saleOrder: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ ...orderRow, status: "voided", deletedAt: new Date() }),
      },
    } as any;
    const service = new SalesReportService(prisma);

    await expect(service.getOrder(SHOP, "order-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
