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
    const existing = { id: "order-existing", shopId: SHOP, items: [] };
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
    const existing = { id: "order-existing", shopId: SHOP, items: [] };
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
  /** 新流程：事务内先 updateMany 条件抢占 completed→voided 终态（count!==1 即 404），
   *  再回读 items 加回库存 + 删流水。重复删除/并发删除只有第一次生效。 */
  function makeDeleteTx(opts: { claimCount?: number; order?: any } = {}) {
    const order = opts.order ?? {
      id: "o1",
      shopId: SHOP,
      status: "completed",
      deletedAt: null,
      items: [{ skuId: "s1", quantity: 2 }],
    };
    const tx = {
      saleOrder: {
        updateMany: vi.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
        findUnique: vi.fn().mockResolvedValue(order),
      },
      sku: { update: vi.fn().mockResolvedValue({ productId: "p1" }) },
      stockMovement: { deleteMany: vi.fn().mockResolvedValue({}) },
    };
    return { tx, order };
  }

  it("整单软删除：抢占终态 + 库存加回 + 删出库流水（不级联删 SaleItem）", async () => {
    const { tx } = makeDeleteTx();
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    } as any;
    const service = new SalesCommandService(prisma, productsStub);

    const res = await service.deleteOrder(SHOP, "o1");

    expect(res).toEqual({ ok: true });
    // 终态守卫：条件更新抢占，where 必须带 shopId + status + deletedAt
    expect(tx.saleOrder.updateMany).toHaveBeenCalledWith({
      where: { id: "o1", shopId: SHOP, status: "completed", deletedAt: null },
      data: { status: "voided", deletedAt: expect.any(Date) },
    });
    expect(tx.sku.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: expect.objectContaining({ stock: { increment: 2 } }),
      }),
    );
    expect(tx.stockMovement.deleteMany).toHaveBeenCalledWith({
      where: { refOrderId: "o1" },
    });
    expect((tx.saleOrder as any).delete).toBeUndefined();
  });

  it("重复删除：第二次抢占终态 count=0 → 404，库存不会被再次加回", async () => {
    const { tx } = makeDeleteTx({ claimCount: 0 });
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    } as any;
    const service = new SalesCommandService(prisma, productsStub);

    await expect(service.deleteOrder(SHOP, "o1")).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.sku.update).not.toHaveBeenCalled();
    expect(tx.stockMovement.deleteMany).not.toHaveBeenCalled();
  });

  it("跨店/不存在的单：同样 404，不产生任何库存变动", async () => {
    // 抢占条件带 shopId，跨店单 count=0
    const { tx } = makeDeleteTx({ claimCount: 0 });
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    } as any;
    const service = new SalesCommandService(prisma, productsStub);

    await expect(service.deleteOrder("other-shop", "o1")).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.sku.update).not.toHaveBeenCalled();
  });
});

describe("SalesCommandService.editOrder", () => {
  it("减少数量会回滚库存并重算总价", async () => {
    const editable = {
      id: "o1",
      shopId: SHOP,
      status: "completed",
      deletedAt: null,
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
      // 事务内重读订单（终态守卫）
      saleOrder: {
        findUnique: vi.fn().mockResolvedValue(editable),
        update: vi.fn().mockResolvedValue({}),
      },
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
    };
    const prisma = {
      saleOrder: {
        findUnique: vi.fn().mockResolvedValue(detail), // refetchDetail 回读
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

  it("已作废/已软删的单不可编辑：事务内终态守卫直接 404，不产生任何库存变动", async () => {
    const tx = {
      saleOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: "o1",
          shopId: SHOP,
          status: "voided",
          deletedAt: new Date(),
          items: [],
        }),
      },
      sku: { updateMany: vi.fn(), update: vi.fn() },
      saleItem: { update: vi.fn(), delete: vi.fn() },
      stockMovement: { createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    } as any;
    const service = new SalesCommandService(prisma, productsStub);

    await expect(
      service.editOrder(SHOP, "o1", { items: [{ id: "i1", quantity: 1, price: 5000 }] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.sku.updateMany).not.toHaveBeenCalled();
    expect(tx.saleItem.update).not.toHaveBeenCalled();
  });

  it("改价后金额溢出 Int32：抛 400 而不是让 PG 报 500", async () => {
    const editable = {
      id: "o1",
      shopId: SHOP,
      status: "completed",
      deletedAt: null,
      orderDiscountCents: 0,
      items: [
        {
          id: "i1",
          skuId: "s1",
          quantity: 1,
          price: 5000,
          subtotal: 5000,
          sku: { id: "s1", productId: "p1", stock: 3, barcode: "B" },
        },
      ],
    };
    const tx = {
      saleOrder: { findUnique: vi.fn().mockResolvedValue(editable), update: vi.fn() },
      // delta=9998>0 会先走原子扣减（count=1 通过），随后溢出校验抛 400
      sku: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      stockMovement: { createMany: vi.fn() },
      saleItem: { update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    } as any;
    const service = new SalesCommandService(prisma, productsStub);

    await expect(
      service.editOrder(SHOP, "o1", {
        items: [{ id: "i1", quantity: 9999, price: 1_000_000_000 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("多行合计金额溢出 Int32：同样 400，不写 totalAmount", async () => {
    // 3 行各 10 亿元（单行合法），求和 30 亿超 Int4
    const mkLine = (n: number) => ({
      id: `i${n}`,
      skuId: `s${n}`,
      quantity: 1,
      price: 5000,
      subtotal: 5000,
      sku: { id: `s${n}`, productId: "p1", stock: 9, barcode: "B" },
    });
    const editable = {
      id: "o1",
      shopId: SHOP,
      status: "completed",
      deletedAt: null,
      orderDiscountCents: 0,
      items: [mkLine(1), mkLine(2), mkLine(3)],
    };
    const tx = {
      saleOrder: { findUnique: vi.fn().mockResolvedValue(editable), update: vi.fn() },
      // quantity 不变 → delta=0，不触发任何库存操作
      sku: { updateMany: vi.fn() },
      stockMovement: { createMany: vi.fn() },
      saleItem: {
        update: vi.fn(),
        delete: vi.fn(),
        findMany: vi
          .fn()
          .mockResolvedValue([
            { subtotal: 1_000_000_000 },
            { subtotal: 1_000_000_000 },
            { subtotal: 1_000_000_000 },
          ]),
      },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    } as any;
    const service = new SalesCommandService(prisma, productsStub);

    await expect(
      service.editOrder(SHOP, "o1", {
        items: [1, 2, 3].map((n) => ({ id: `i${n}`, quantity: 1, price: 1_000_000_000 })),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.saleOrder.update).not.toHaveBeenCalled();
  });
});
