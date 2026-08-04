import { describe, it, expect, vi } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SalesCommandService } from "./sales-command.service";
import type { PrismaService } from "../prisma/prisma.service";

const SHOP = "shop-1";

/** products.recomputeArchive 是 SalesCommandService 的依赖，此处 stub 掉避免拉起真实 Prisma */
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
      updateMany: vi.fn().mockResolvedValue({ count: opts.updateManyCount ?? 1 }),
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
    stockMovement: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
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

describe("SalesCommandService.createSale", () => {
  it("正常开单：原子扣减库存并写一条出库流水", async () => {
    const prisma = makePrisma({ sku: { ...okSku } }) as any;
    const service = new SalesCommandService(prisma, productsStub);

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
    // E7：库存流水批量化，1 件商品 → 1 次 createMany（数组长度 1）
    expect(prisma.__tx.stockMovement.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.__tx.stockMovement.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          skuId: "sku-1",
          type: "out",
          quantity: -2,
          refOrderId: "order-1",
          operatorId: "user-1",
        }),
      ],
    });
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
    const service = new SalesCommandService(prisma, productsStub);

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
    const service = new SalesCommandService(prisma, productsStub);

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
    const service = new SalesCommandService(prisma, productsStub);

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
    const service = new SalesCommandService(prisma, productsStub);

    await expect(
      service.createSale(SHOP, "user-1", {
        opId: "op-3",
        items: [{ skuId: "sku-1", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("SalesCommandService.deleteOrder", () => {
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
    const service = new SalesCommandService(prisma, productsStub);

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

describe("SalesCommandService.editOrder", () => {
  it("减少数量会回滚库存并重算总价", async () => {
    const editable = {
      id: "o1",
      shopId: SHOP,
      orderDiscountCents: 0,
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
    // editOrder 走 refetchDetail 回读详情
    const detail = {
      id: "o1",
      shopId: SHOP,
      operatorId: null,
      operator: null,
      status: "completed",
      deletedAt: null,
      totalAmount: 5000,
      orderDiscountCents: 0,
      createdAt: new Date(),
      items: [
        {
          id: "i1",
          skuId: "s1",
          quantity: 1,
          price: 5000,
          cost: 0,
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
      stockMovement: {
        create: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
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
          // 第一次：editOrder 取 editable（含 sku）；第二次：refetchDetail 取 detail（含 product）
          .mockResolvedValueOnce(editable)
          .mockResolvedValueOnce(detail),
      },
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    } as any;
    const service = new SalesCommandService(prisma, productsStub);

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
    // E7：库存调整流水批量化，delta=-1 → 1 条 adjust 流水
    expect(tx.stockMovement.createMany).toHaveBeenCalledTimes(1);
    expect(tx.stockMovement.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          skuId: "s1",
          type: "adjust",
          quantity: 1, // -delta = -(-1) = 1（加库存）
          refOrderId: "o1",
        }),
      ],
    });
    expect(result.totalAmount).toBe(5000);
  });
});
