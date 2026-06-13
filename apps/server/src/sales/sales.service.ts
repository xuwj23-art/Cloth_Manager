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
   *  2) 事务 —— 校验库存、写销售单、写库存流水、扣减 stock 一起成功或一起失败。
   *  3) 防超卖 —— 库存不足直接报错。
   */
  async createSale(
    shopId: string,
    operatorId: string | null,
    input: CreateSaleOrderInput,
  ) {
    // 幂等检查
    const existing = await this.prisma.saleOrder.findUnique({
      where: { opId: input.opId },
      include: { items: true },
    });
    if (existing) return existing;

    return this.prisma.$transaction(async (tx) => {
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
        const sku = await tx.sku.findUnique({
          where: { id: item.skuId },
          include: { product: true },
        });
        if (!sku || sku.product.shopId !== shopId) {
          throw new NotFoundException(`SKU 不存在：${item.skuId}`);
        }
        affectedProductIds.add(sku.productId);
        if (sku.stock < item.quantity) {
          throw new BadRequestException(
            `库存不足：${sku.barcode} 现有 ${sku.stock}，需 ${item.quantity}`,
          );
        }
        const price = item.price ?? sku.salePrice;
        const subtotal = price * item.quantity;
        total += subtotal;
        itemsData.push({
          skuId: sku.id,
          quantity: item.quantity,
          price,
          cost: sku.costPrice, // 快照当时进价，保证历史利润不被后续改价影响
          subtotal,
        });
      }

      const order = await tx.saleOrder.create({
        data: {
          shopId,
          operatorId,
          status: "completed",
          totalAmount: total,
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
        await tx.sku.update({
          where: { id: item.skuId },
          data: {
            stock: { decrement: item.quantity },
            version: { increment: 1 },
          },
        });
      }

      // 售罄自动归档：受影响商品库存清零则自动下架
      for (const productId of affectedProductIds) {
        await this.products.recomputeArchive(tx, productId);
      }

      return order;
    });
  }

  /** 销售流水（最近 500 笔），含明细名称与操作人 */
  async listOrders(shopId: string): Promise<SaleOrderDetail[]> {
    const orders = await this.prisma.saleOrder.findMany({
      where: { shopId },
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
   * 删除整单（误操作兜底）：把每件已扣的库存加回，删除该单的库存流水与单据，
   * 并刷新受影响商品的售罄归档状态。事务保证一致。
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
      // 删除该单的库存流水（出库记录），再删单据（明细随单据级联删除）
      await tx.stockMovement.deleteMany({ where: { refOrderId: id } });
      await tx.saleOrder.delete({ where: { id } });
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

    await this.prisma.$transaction(async (tx) => {
      const affected = new Set<string>();
      for (const r of input.items) {
        const existing = byId.get(r.id)!;
        affected.add(existing.sku.productId);
        const delta = r.quantity - existing.quantity; // >0 多卖（扣库存），<0 退回（加库存）
        if (delta > 0 && existing.sku.stock < delta) {
          throw new BadRequestException(
            `库存不足：${existing.sku.barcode} 现有 ${existing.sku.stock}，需再扣 ${delta}`,
          );
        }
        if (delta !== 0) {
          await tx.sku.update({
            where: { id: existing.skuId },
            data: {
              stock: { increment: -delta },
              version: { increment: 1 },
            },
          });
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

      // 重算总价（取该单剩余明细）
      const remaining = await tx.saleItem.findMany({ where: { orderId: id } });
      if (remaining.length === 0) {
        throw new BadRequestException(
          "账单不能为空，请保留至少一件商品，或使用「删除整单」",
        );
      }
      const total = remaining.reduce((s, it) => s + it.subtotal, 0);
      await tx.saleOrder.update({ where: { id }, data: { totalAmount: total } });
      for (const productId of affected) {
        await this.products.recomputeArchive(tx, productId);
      }
    });

    return this.getOrder(shopId, id);
  }

  /** 单据详情 */
  async getOrder(shopId: string, id: string): Promise<SaleOrderDetail> {
    const order = await this.prisma.saleOrder.findUnique({
      where: { id },
      include: {
        operator: true,
        items: { include: { sku: { include: { product: true } } } },
      },
    });
    if (!order || order.shopId !== shopId) {
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
      where: { shopId, status: "completed", createdAt: { gte: start } },
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
        order: { shopId, status: "completed", createdAt: { gte: since } },
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
    createdAt: Date;
    items: {
      id: string;
      skuId: string;
      quantity: number;
      price: number;
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
      itemCount: o.items.reduce((s, it) => s + it.quantity, 0),
      createdAt: o.createdAt.toISOString(),
      items: o.items.map((it) => ({
        id: it.id,
        skuId: it.skuId,
        quantity: it.quantity,
        price: it.price,
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
