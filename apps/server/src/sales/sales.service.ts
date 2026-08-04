import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  CreateSaleOrderInput,
  DailySalesStat,
  EditSaleOrderInput,
  MonthlySalesReport,
  OperatorSalesStat,
  SaleOrderDetail,
  SalesBucket,
  SalesRange,
  SalesReport,
  SalesStat,
  SalesSummary,
  SalesWindowStats,
  TopSkuStat,
} from "@cloth-scan/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ProductsService } from "../products/products.service";

/** 本地时区下的「今日 0 点」 */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 本地时区下「本周一 0 点」（周一为一周起点） */
function startOfWeek(): Date {
  const d = startOfToday();
  const day = d.getDay(); // 0=周日,1=周一...
  const diff = (day + 6) % 7; // 距上一个周一的天数
  d.setDate(d.getDate() - diff);
  return d;
}

/** 本地时区下「本月 1 号 0 点」 */
function startOfMonth(): Date {
  const d = startOfToday();
  d.setDate(1);
  return d;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  /**
   * 创建一笔销售并扣减库存。
   * 关键保证：
   *  1) 幂等 —— 同一 opId 重复提交直接返回已存在的单（离线重传安全）。
   *     不做外层 findUnique(opId) 预检查（会与事务内 create 形成 TOCTOU 窗口），
   *     改为直接进事务 create，捕获 P2002 后回查已存在单返回。
   *  2) 事务 —— 校验库存、写销售单、写库存流水、扣减 stock 一起成功或一起失败，
   *     隔离级别 Serializable（彻底杜绝并发超卖）。
   *  3) 防超卖 —— 用 updateMany 带 stock>=qty 条件做原子条件更新，count!==1 即库存不足，
   *     读写不再分离，无超卖窗口。
   */
  async createSale(
    shopId: string,
    operatorId: string | null,
    input: CreateSaleOrderInput,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          let total = 0;
          const itemsData: {
            skuId: string;
            quantity: number;
            price: number;
            cost: number;
            subtotal: number;
          }[] = [];
          const affectedProductIds = new Set<string>();

          for (const item of input.items) {
            // 原子防超卖：updateMany 带 stock>=qty 条件，count===1 才算扣减成功。
            // product.shopId 关系过滤提供 DB 层门店隔离（与应用层 shopId 校验互为兜底）。
            const updated = await tx.sku.updateMany({
              where: {
                id: item.skuId,
                product: { shopId },
                stock: { gte: item.quantity },
              },
              data: {
                stock: { decrement: item.quantity },
                version: { increment: 1 },
              },
            });
            if (updated.count !== 1) {
              // 库存不足或 SKU 不存在/跨店——回查给准确错误信息
              const sku = await tx.sku.findUnique({
                where: { id: item.skuId },
                include: { product: true },
              });
              if (!sku || sku.product.shopId !== shopId) {
                throw new NotFoundException(`SKU 不存在：${item.skuId}`);
              }
              throw new BadRequestException(
                `库存不足：${sku.barcode} 现有 ${sku.stock}，需 ${item.quantity}`,
              );
            }
            // 回查拿 costPrice（进价快照）和 salePrice（price 兜底）
            const sku = await tx.sku.findUnique({
              where: { id: item.skuId },
              include: { product: true },
            });
            affectedProductIds.add(sku!.productId);
            const price = item.price ?? sku!.salePrice;
            const subtotal = price * item.quantity;
            total += subtotal;
            itemsData.push({
              skuId: sku!.id,
              quantity: item.quantity,
              price,
              cost: sku!.costPrice, // 快照当时进价，保证历史利润不被后续改价影响
              subtotal,
            });
          }

          // 整单优惠：各行按原价入库（subtotal 不变），优惠单独记录；
          // totalAmount 即实收 = Σ各行subtotal - orderDiscountCents。优惠不得使实收为负。
          const orderDiscountCents = input.orderDiscountCents ?? 0;
          if (orderDiscountCents > total) {
            throw new BadRequestException(
              `整单优惠（${orderDiscountCents} 分）不能超过原价合计（${total} 分）`,
            );
          }
          const paidAmount = total - orderDiscountCents;

          const order = await tx.saleOrder.create({
            data: {
              shopId,
              operatorId,
              status: "completed",
              totalAmount: paidAmount,
              orderDiscountCents,
              opId: input.opId,
              items: { create: itemsData },
            },
            include: { items: true },
          });

          for (const item of itemsData) {
            await tx.stockMovement.create({
              data: {
                skuId: item.skuId,
                type: "out",
                quantity: -item.quantity,
                refOrderId: order.id,
                operatorId,
                opId: randomUUID(),
              },
            });
          }

          // 售罄自动归档：受影响商品库存清零则自动下架
          for (const productId of affectedProductIds) {
            await this.products.recomputeArchive(tx, productId);
          }

          return order;
        },
        // A2：关键写事务用 Serializable，彻底杜绝并发超卖
        { isolationLevel: "Serializable" },
      );
    } catch (e: unknown) {
      // A1：保证 opId 幂等不被并发破坏。两种竞态失败都需要兜底：
      //  - P2002：loser 跑到 saleOrder.create 时撞 opId unique 约束（说明 winner 已提交同 opId 单）
      //  - P2034：Serializable 隔离级别下，loser 在 updateMany 阶段被 PG 检测到序列化冲突
      //           而中止（SQLSTATE 40001，Prisma 标记可重试）。对幂等 create 而言，
      //           "重试"= winner 已用同 opId 提交了同一单，直接回查返回它即可。
      //   注意：只有当 DB 里确有同 opId 单时才视为幂等命中，否则 P2034 是真并发冲突，
      //   应向上抛（调用方决定重试）。不减弱 Serializable 隔离级别。
      const code = (e as { code?: unknown } | null)?.code;
      const isIdempotencyRace =
        code === "P2002" ||
        code === "P2034";
      if (isIdempotencyRace) {
        // P2002 还要确认是 opId 字段冲突（SaleOrder 唯一约束目前只有 opId，防御性判断）
        if (code === "P2002") {
          const target = (e as { meta?: { target?: unknown[] } }).meta?.target;
          if (!Array.isArray(target) || !(target as string[]).includes("opId")) {
            throw e;
          }
        }
        const existing = await this.prisma.saleOrder.findUnique({
          where: { opId: input.opId },
          include: { items: true },
        });
        if (existing) return existing;
        // P2034 但无同 opId 单：真并发冲突（非幂等重复），向上抛由调用方重试
      }
      throw e;
    }
  }

  /** 销售流水（最近 500 笔），含明细名称与操作人。过滤软删单（voided + deletedAt 非空） */
  async listOrders(shopId: string): Promise<SaleOrderDetail[]> {
    const orders = await this.prisma.saleOrder.findMany({
      where: { shopId, status: "completed", deletedAt: null },
      include: {
        operator: true,
        items: { include: { sku: { include: { product: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return orders.map((o) => this.toDetail(o));
  }

  /**
   * 删除整单（误操作兜底）：软删除——把每件已扣的库存加回、删除该单的库存出库流水，
   * 然后把单据置为 voided + 写 deletedAt（保留行 + 明细作为审计痕迹，不级联删 SaleItem）。
   * 所有报表/流水查询过滤 status=completed + deletedAt=null，使已删单对前台不可见。
   * 事务保证一致。
   */
  async deleteOrder(shopId: string, id: string): Promise<{ ok: true }> {
    const order = await this.prisma.saleOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order || order.shopId !== shopId) {
      throw new NotFoundException("单据不存在");
    }

    await this.prisma.$transaction(async (tx) => {
      const affected = new Set<string>();
      for (const it of order.items) {
        const sku = await tx.sku.update({
          where: { id: it.skuId },
          data: {
            stock: { increment: it.quantity },
            version: { increment: 1 },
          },
        });
        affected.add(sku.productId);
      }
      // 删除该单的库存出库流水（原 createSale 写的 type=out 记录）。
      // 软删后保留 SaleItem 行作为审计痕迹，不再级联删单据。
      await tx.stockMovement.deleteMany({ where: { refOrderId: id } });
      await tx.saleOrder.update({
        where: { id },
        data: { status: "voided", deletedAt: new Date() },
      });
      for (const productId of affected) {
        await this.products.recomputeArchive(tx, productId);
      }
    });

    return { ok: true };
  }

  /**
   * 编辑账单：改价 / 改数量 / 删某件（quantity=0）。不支持加商品。
   * 库存按新旧数量差额回滚或扣减（扣减时校验库存）；总价与售罄状态同步刷新。
   * 若改后全单为空，则整单删除。
   */
  async editOrder(
    shopId: string,
    id: string,
    input: EditSaleOrderInput,
  ): Promise<SaleOrderDetail> {
    const order = await this.prisma.saleOrder.findUnique({
      where: { id },
      include: { items: { include: { sku: true } } },
    });
    if (!order || order.shopId !== shopId) {
      throw new NotFoundException("单据不存在");
    }
    const byId = new Map(order.items.map((it) => [it.id, it]));
    for (const r of input.items) {
      if (!byId.has(r.id)) {
        throw new NotFoundException(`明细不存在：${r.id}`);
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        const affected = new Set<string>();
        for (const r of input.items) {
          const existing = byId.get(r.id)!;
          affected.add(existing.sku.productId);
          const delta = r.quantity - existing.quantity; // >0 多卖（扣库存），<0 退回（加库存）
          if (delta !== 0) {
            if (delta > 0) {
              // 原子防超卖：updateMany 带 stock>=delta 条件，count===1 才算扣减成功。
              // product.shopId 关系过滤提供 DB 层门店隔离。
              const updated = await tx.sku.updateMany({
                where: {
                  id: existing.skuId,
                  product: { shopId },
                  stock: { gte: delta },
                },
                data: {
                  stock: { decrement: delta },
                  version: { increment: 1 },
                },
              });
              if (updated.count !== 1) {
                // 库存不足或 SKU 不存在/跨店——回查给准确错误
                const sku = await tx.sku.findUnique({
                  where: { id: existing.skuId },
                  include: { product: true },
                });
                if (!sku || sku.product.shopId !== shopId) {
                  throw new NotFoundException(`SKU 不存在：${existing.skuId}`);
                }
                throw new BadRequestException(
                  `库存不足：${sku.barcode} 现有 ${sku.stock}，需再扣 ${delta}`,
                );
              }
            } else {
              // 加库存（用户减量或删行）：无库存上限约束，仍带门店隔离
              const returnQty = -delta;
              const updated = await tx.sku.updateMany({
                where: { id: existing.skuId, product: { shopId } },
                data: {
                  stock: { increment: returnQty },
                  version: { increment: 1 },
                },
              });
              if (updated.count !== 1) {
                // SKU 不存在或跨店——理论上不应发生（前面已校验属于本单本店）
                throw new NotFoundException(`SKU 不存在：${existing.skuId}`);
              }
            }
            await tx.stockMovement.create({
              data: {
                skuId: existing.skuId,
                type: "adjust",
                quantity: -delta,
                refOrderId: id,
                opId: randomUUID(),
              },
            });
          }
          if (r.quantity === 0) {
            await tx.saleItem.delete({ where: { id: r.id } });
          } else {
            await tx.saleItem.update({
              where: { id: r.id },
              data: { quantity: r.quantity, price: r.price, subtotal: r.price * r.quantity },
            });
          }
        }

        // 重算实收：各行 subtotal 之和 - 该单已记录的 orderDiscountCents（≥0）
        const remaining = await tx.saleItem.findMany({ where: { orderId: id } });
        if (remaining.length === 0) {
          throw new BadRequestException(
            "账单不能为空，请保留至少一件商品，或使用「删除整单」",
          );
        }
        const subtotalSum = remaining.reduce((s, it) => s + it.subtotal, 0);
        // 编辑不改优惠金额；若改后 subtotal 之和小于已记优惠，夹到 0（不允许实收为负）
        const disc = order.orderDiscountCents ?? 0;
        const paidAmount = Math.max(0, subtotalSum - disc);
        await tx.saleOrder.update({
          where: { id },
          data: { totalAmount: paidAmount },
        });
        for (const productId of affected) {
          await this.products.recomputeArchive(tx, productId);
        }
      },
      // 防超卖：关键写事务用 Serializable
      { isolationLevel: "Serializable" },
    );

    return this.getOrder(shopId, id);
  }

  /** 某一天（本地日期 YYYY-MM-DD）的销售流水，按时间倒序。过滤软删单 */
  async listByDay(shopId: string, date: string): Promise<SaleOrderDetail[]> {
    const [y, m, d] = date.split("-").map(Number);
    if (!y || !m || !d) return [];
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
    const orders = await this.prisma.saleOrder.findMany({
      where: {
        shopId,
        status: "completed",
        deletedAt: null,
        createdAt: { gte: start, lt: end },
      },
      include: {
        operator: true,
        items: { include: { sku: { include: { product: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    return orders.map((o) => this.toDetail(o));
  }

  /** 单据详情。软删单（voided + deletedAt 非空）视为不存在 */
  async getOrder(shopId: string, id: string): Promise<SaleOrderDetail> {
    const order = await this.prisma.saleOrder.findUnique({
      where: { id },
      include: {
        operator: true,
        items: { include: { sku: { include: { product: true } } } },
      },
    });
    if (
      !order ||
      order.shopId !== shopId ||
      order.status === "voided" ||
      order.deletedAt !== null
    ) {
      throw new NotFoundException("单据不存在");
    }
    return this.toDetail(order);
  }

  /** 报表汇总：今日/本周/本月营业额、单数、销量 + 近 7 天热销榜 */
  async getSummary(shopId: string): Promise<SalesSummary> {
    const [today, week, month, topSkus] = await Promise.all([
      this.windowStats(shopId, startOfToday()),
      this.windowStats(shopId, startOfWeek()),
      this.windowStats(shopId, startOfMonth()),
      this.topSkus(shopId, startOfWeek()),
    ]);
    return { today, week, month, topSkus };
  }

  /**
   * 报表（含利润 + 日期下钻）：
   *  - today：仅合计，无下钻桶
   *  - week ：本周一起，按「天」下钻（周一…今天）
   *  - month：本月 1 号起，按「周」下钻（第1周=1~7号…第5周=29~月末）
   * 桶顺序从早到近。利润 = 成交价合计 − 进价快照×数量。
   */
  async report(shopId: string, range: SalesRange): Promise<SalesReport> {
    const now = new Date();
    const start =
      range === "today"
        ? startOfToday()
        : range === "week"
          ? startOfWeek()
          : startOfMonth();

    const orders = await this.prisma.saleOrder.findMany({
      where: {
        shopId,
        status: "completed",
        deletedAt: null,
        createdAt: { gte: start },
      },
      include: { items: true, operator: true },
      orderBy: { createdAt: "asc" },
    });

    // 预建桶（空桶也展示，便于看趋势）
    const buckets = this.buildBuckets(range, now);
    const byKey = new Map(buckets.map((b) => [b.key, b]));

    const total: SalesStat = {
      revenue: 0,
      cost: 0,
      profit: 0,
      orders: 0,
      quantity: 0,
    };

    for (const o of orders) {
      let orderQty = 0;
      let orderCost = 0;
      for (const it of o.items) {
        orderQty += it.quantity;
        orderCost += it.cost * it.quantity;
      }
      total.revenue += o.totalAmount;
      total.cost += orderCost;
      total.orders += 1;
      total.quantity += orderQty;

      const key = this.bucketKey(range, o.createdAt);
      const b = key ? byKey.get(key) : undefined;
      if (b) {
        b.revenue += o.totalAmount;
        b.profit += o.totalAmount - orderCost;
        b.orders += 1;
        b.quantity += orderQty;
      }
    }
    total.profit = total.revenue - total.cost;

    const topSkus = await this.topSkus(shopId, start);
    const byOperator = this.operatorStats(orders);
    return { range, total, buckets, topSkus, byOperator };
  }

  /**
   * 历史某月销售（按天）：当月合计 + 各店员销售额 + 每天明细（1 号→月末，由早到近）。
   * year/month 为本地年月（month 1-12）。空数据的天也会列出（便于看趋势）。
   */
  async monthlyReport(
    shopId: string,
    year: number,
    month: number,
  ): Promise<MonthlySalesReport> {
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 1, 0, 0, 0, 0);

    const orders = await this.prisma.saleOrder.findMany({
      where: {
        shopId,
        status: "completed",
        deletedAt: null,
        createdAt: { gte: start, lt: end },
      },
      include: { items: true, operator: true },
      orderBy: { createdAt: "asc" },
    });

    const pad = (n: number) => String(n).padStart(2, "0");
    const daysInMonth = new Date(year, month, 0).getDate();
    const days: DailySalesStat[] = Array.from(
      { length: daysInMonth },
      (_, i) => ({
        date: `${year}-${pad(month)}-${pad(i + 1)}`,
        revenue: 0,
        profit: 0,
        orders: 0,
        quantity: 0,
      }),
    );

    const total: SalesStat = {
      revenue: 0,
      cost: 0,
      profit: 0,
      orders: 0,
      quantity: 0,
    };

    for (const o of orders) {
      let qty = 0;
      let cost = 0;
      for (const it of o.items) {
        qty += it.quantity;
        cost += it.cost * it.quantity;
      }
      total.revenue += o.totalAmount;
      total.cost += cost;
      total.orders += 1;
      total.quantity += qty;

      const d = days[o.createdAt.getDate() - 1];
      if (d) {
        d.revenue += o.totalAmount;
        d.profit += o.totalAmount - cost;
        d.orders += 1;
        d.quantity += qty;
      }
    }
    total.profit = total.revenue - total.cost;

    return { year, month, total, byOperator: this.operatorStats(orders), days };
  }

  /** 把订单列表汇总成各店员销售额（按营业额从高到低） */
  private operatorStats(
    orders: {
      operatorId: string | null;
      operator: { name: string } | null;
      totalAmount: number;
      items: { quantity: number }[];
    }[],
  ): OperatorSalesStat[] {
    const map = new Map<string, OperatorSalesStat>();
    for (const o of orders) {
      const key = o.operatorId ?? "__none__";
      let s = map.get(key);
      if (!s) {
        s = {
          operatorId: o.operatorId,
          operatorName: o.operator?.name ?? null,
          revenue: 0,
          orders: 0,
          quantity: 0,
        };
        map.set(key, s);
      }
      s.revenue += o.totalAmount;
      s.orders += 1;
      s.quantity += o.items.reduce((q, it) => q + it.quantity, 0);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }

  /** 生成空桶（含 label），顺序从早到近 */
  private buildBuckets(range: SalesRange, now: Date): SalesBucket[] {
    const empty = (key: string, label: string): SalesBucket => ({
      key,
      label,
      revenue: 0,
      profit: 0,
      orders: 0,
      quantity: 0,
    });
    if (range === "today") return [];
    if (range === "week") {
      const names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
      const todayIdx = (now.getDay() + 6) % 7; // 周一=0
      return names.slice(0, todayIdx + 1).map((n, i) => empty(`d${i}`, n));
    }
    // month：按日期段分周，最多 5 周（第5周=29~月末）
    const maxIdx = Math.min(Math.floor((now.getDate() - 1) / 7), 4);
    return Array.from({ length: maxIdx + 1 }, (_, i) =>
      empty(`w${i}`, `第${i + 1}周`),
    );
  }

  /** 某订单时间落在哪个桶 */
  private bucketKey(range: SalesRange, date: Date): string | null {
    if (range === "today") return null;
    if (range === "week") return `d${(date.getDay() + 6) % 7}`;
    return `w${Math.min(Math.floor((date.getDate() - 1) / 7), 4)}`;
  }

  private async windowStats(
    shopId: string,
    since: Date,
  ): Promise<SalesWindowStats> {
    const where = {
      shopId,
      status: "completed" as const,
      deletedAt: null,
      createdAt: { gte: since },
    };
    const [orderAgg, itemAgg] = await Promise.all([
      this.prisma.saleOrder.aggregate({
        where,
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.saleItem.aggregate({
        where: { order: where },
        _sum: { quantity: true },
      }),
    ]);
    return {
      revenue: orderAgg._sum.totalAmount ?? 0,
      orders: orderAgg._count,
      quantity: itemAgg._sum.quantity ?? 0,
    };
  }

  private async topSkus(shopId: string, since: Date): Promise<TopSkuStat[]> {
    const grouped = await this.prisma.saleItem.groupBy({
      by: ["skuId"],
      where: {
        order: {
          shopId,
          status: "completed",
          deletedAt: null,
          createdAt: { gte: since },
        },
      },
      _sum: { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    });
    if (grouped.length === 0) return [];

    const skus = await this.prisma.sku.findMany({
      where: { id: { in: grouped.map((g) => g.skuId) } },
      include: { product: true },
    });
    const byId = new Map(skus.map((s) => [s.id, s]));

    return grouped.map((g) => {
      const sku = byId.get(g.skuId);
      return {
        skuId: g.skuId,
        productName: sku?.product.name ?? "(已删除)",
        color: sku?.color ?? "",
        size: sku?.size ?? "",
        barcode: sku?.barcode ?? "",
        quantity: g._sum.quantity ?? 0,
        revenue: g._sum.subtotal ?? 0,
      };
    });
  }

  private toDetail(o: {
    id: string;
    shopId: string;
    operatorId: string | null;
    operator: { name: string } | null;
    status: string;
    totalAmount: number;
    orderDiscountCents: number;
    createdAt: Date;
    items: {
      id: string;
      skuId: string;
      quantity: number;
      price: number;
      cost: number;
      subtotal: number;
      sku: {
        color: string;
        size: string;
        barcode: string;
        product: { name: string; coverImage: string | null };
      };
    }[];
  }): SaleOrderDetail {
    return {
      id: o.id,
      shopId: o.shopId,
      operatorId: o.operatorId,
      operatorName: o.operator?.name ?? null,
      status: o.status as SaleOrderDetail["status"],
      totalAmount: o.totalAmount,
      orderDiscountCents: o.orderDiscountCents,
      itemCount: o.items.reduce((s, it) => s + it.quantity, 0),
      createdAt: o.createdAt.toISOString(),
      items: o.items.map((it) => ({
        id: it.id,
        skuId: it.skuId,
        quantity: it.quantity,
        price: it.price,
        cost: it.cost,
        subtotal: it.subtotal,
        productName: it.sku.product.name,
        color: it.sku.color,
        size: it.sku.size,
        barcode: it.sku.barcode,
        coverImage: it.sku.product.coverImage,
      })),
    };
  }
}
