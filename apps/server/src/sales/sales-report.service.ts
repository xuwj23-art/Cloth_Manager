import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  DailySalesStat,
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

/**
 * 销售读操作（报表侧）：listOrders / getOrder / listByDay / getSummary / report /
 * monthlyReport。只读，仅注入 PrismaService，无副作用、无 ProductsService 依赖。
 *
 * E2 优化（报表聚合下推 DB）：原 SalesService 用 findMany 拉全量订单到内存再 reduce
 * 聚合收入/单数/销量/利润。现按下推策略重写：
 *  - 收入/单数 → saleOrder.aggregate / saleOrder.groupBy（DB 求和，零内存）
 *  - 销量 → saleItem.aggregate（DB 求和）
 *  - 热销榜 topSkus → saleItem.groupBy（已下推，保留）
 *  - 店员销售 byOperator → saleOrder.groupBy by operatorId（DB 求和收入/单数）
 *  - 利润（cost*quantity）→ 保留内存聚合：Prisma _sum 无法表达字段相乘
 *    （saleItem.cost 是单价快照，需 cost×quantity），改用轻量 saleItem.findMany
 *    仅 select {cost, quantity} 后 reduce，避免拉起完整订单及关联。
 *  - 日期桶（按天/按周）→ 保留内存归组：Prisma groupBy 无法对 createdAt 做 date-trunc，
 *    单店月度数据量小，单次轻量 findMany + reduce 比 raw SQL 更简单且足够高效。
 */
@Injectable()
export class SalesReportService {
  constructor(private readonly prisma: PrismaService) {}

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
   *
   * E2：合计（revenue/orders/quantity/cost）下推 DB aggregate；日期桶保留内存归组。
   */
  async report(shopId: string, range: SalesRange): Promise<SalesReport> {
    const now = new Date();
    const start =
      range === "today" ? startOfToday() : range === "week" ? startOfWeek() : startOfMonth();

    const where = {
      shopId,
      status: "completed" as const,
      deletedAt: null,
      createdAt: { gte: start },
    };

    // 合计下推 DB：收入 + 单数（订单级），销量（明细级）
    const [orderAgg, itemAgg, topSkus, byOperatorAgg, bucketRows] = await Promise.all([
      this.prisma.saleOrder.aggregate({
        where,
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.saleItem.aggregate({
        where: { order: where },
        _sum: { quantity: true },
      }),
      this.topSkus(shopId, start),
      this.operatorGroupBy(where),
      // 日期桶归组所需的最小字段集：每单时间 + 实收 + 各明细 cost×quantity 聚合
      range === "today"
        ? Promise.resolve([])
        : this.prisma.saleOrder.findMany({
            where,
            select: {
              createdAt: true,
              totalAmount: true,
              items: { select: { cost: true, quantity: true } },
            },
            orderBy: { createdAt: "asc" },
          }),
    ]);

    // 利润 = revenue − Σ(cost×quantity)：cost 是单价快照，DB _sum 无法相乘，
    // 取合计明细 cost/quantity 在内存算（已是聚合后的两列，非全字段）。
    const totalCost = await this.sumCost(where);

    const total: SalesStat = {
      revenue: orderAgg._sum.totalAmount ?? 0,
      cost: totalCost,
      profit: (orderAgg._sum.totalAmount ?? 0) - totalCost,
      orders: orderAgg._count,
      quantity: itemAgg._sum.quantity ?? 0,
    };

    // 日期桶：内存归组（groupBy 无法 date-trunc；数据量小）
    const buckets = this.buildBuckets(range, now);
    if (buckets.length > 0) {
      const byKey = new Map(buckets.map((b) => [b.key, b]));
      for (const o of bucketRows) {
        const orderCost = o.items.reduce((s, it) => s + it.cost * it.quantity, 0);
        const orderQty = o.items.reduce((s, it) => s + it.quantity, 0);
        const key = this.bucketKey(range, o.createdAt);
        const b = key ? byKey.get(key) : undefined;
        if (b) {
          b.revenue += o.totalAmount;
          b.profit += o.totalAmount - orderCost;
          b.orders += 1;
          b.quantity += orderQty;
        }
      }
    }

    const byOperator = await this.materializeOperatorStats(byOperatorAgg, where);

    return { range, total, buckets, topSkus, byOperator };
  }

  /**
   * 历史某月销售（按天）：当月合计 + 各店员销售额 + 每天明细（1 号→月末，由早到近）。
   * year/month 为本地年月（month 1-12）。空数据的天也会列出（便于看趋势）。
   *
   * E2：合计下推 DB aggregate；按天桶保留内存归组（groupBy 无法 date-trunc）。
   */
  async monthlyReport(shopId: string, year: number, month: number): Promise<MonthlySalesReport> {
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 1, 0, 0, 0, 0);

    const where = {
      shopId,
      status: "completed" as const,
      deletedAt: null,
      createdAt: { gte: start, lt: end },
    };

    // 合计下推 DB
    const [orderAgg, itemAgg, totalCost, byOperatorAgg, dayRows] = await Promise.all([
      this.prisma.saleOrder.aggregate({
        where,
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.saleItem.aggregate({
        where: { order: where },
        _sum: { quantity: true },
      }),
      this.sumCost(where),
      this.operatorGroupBy(where),
      // 按天归组所需最小字段
      this.prisma.saleOrder.findMany({
        where,
        select: {
          createdAt: true,
          totalAmount: true,
          items: { select: { cost: true, quantity: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const total: SalesStat = {
      revenue: orderAgg._sum.totalAmount ?? 0,
      cost: totalCost,
      profit: (orderAgg._sum.totalAmount ?? 0) - totalCost,
      orders: orderAgg._count,
      quantity: itemAgg._sum.quantity ?? 0,
    };

    const pad = (n: number) => String(n).padStart(2, "0");
    const daysInMonth = new Date(year, month, 0).getDate();
    const days: DailySalesStat[] = Array.from({ length: daysInMonth }, (_, i) => ({
      date: `${year}-${pad(month)}-${pad(i + 1)}`,
      revenue: 0,
      profit: 0,
      orders: 0,
      quantity: 0,
    }));

    for (const o of dayRows) {
      const cost = o.items.reduce((s, it) => s + it.cost * it.quantity, 0);
      const qty = o.items.reduce((s, it) => s + it.quantity, 0);
      const d = days[o.createdAt.getDate() - 1];
      if (d) {
        d.revenue += o.totalAmount;
        d.profit += o.totalAmount - cost;
        d.orders += 1;
        d.quantity += qty;
      }
    }

    const byOperator = await this.materializeOperatorStats(byOperatorAgg, where);

    return { year, month, total, byOperator, days };
  }

  // ---- E2 下推辅助 -------------------------------------------------------

  /**
   * 利润所需 cost 合计：saleItem.cost 是开单时的单价进价快照，总成本 = Σ(cost×quantity)。
   * Prisma _sum 无法表达字段相乘，取轻量明细行（仅 cost/quantity 两列）后内存相乘。
   * 比拉起完整订单 + 关联sku/product 轻得多。
   */
  private async sumCost(where: {
    shopId: string;
    status: "completed";
    deletedAt: null;
    createdAt: { gte: Date } | { gte: Date; lt: Date };
  }): Promise<number> {
    const items = await this.prisma.saleItem.findMany({
      where: { order: where },
      select: { cost: true, quantity: true },
    });
    return items.reduce((s, it) => s + it.cost * it.quantity, 0);
  }

  /**
   * 店员销售额聚合（DB 下推）：按 operatorId 分组求收入与单数。
   * 返回原始 groupBy 结果，由 materializeOperatorStats 补 operatorName + 销量。
   */
  private async operatorGroupBy(where: {
    shopId: string;
    status: "completed";
    deletedAt: null;
    createdAt: { gte: Date } | { gte: Date; lt: Date };
  }) {
    return this.prisma.saleOrder.groupBy({
      by: ["operatorId"],
      where,
      _sum: { totalAmount: true },
      _count: true,
      orderBy: { _sum: { totalAmount: "desc" } },
    });
  }

  /**
   * 把 operatorGroupBy 的结果物化为 OperatorSalesStat[]：
   *  - operatorName：批量回查 user 表补名字（一次 findMany，只取 id+name）
   *  - quantity：每店员销量需要明细级聚合，Prisma 无法跨表按 order.operatorId 分组明细，
   *    取轻量订单行（仅 operatorId + items.quantity）后内存按店员归组销量。
   *    收入/单数仍走 groupBy 的 DB 结果（已下推），保证这两项零内存。
   */
  private async materializeOperatorStats(
    grouped: { operatorId: string | null; _sum: { totalAmount: number | null }; _count: number }[],
    where: {
      shopId: string;
      status: "completed";
      deletedAt: null;
      createdAt: { gte: Date } | { gte: Date; lt: Date };
    },
  ): Promise<OperatorSalesStat[]> {
    if (grouped.length === 0) return [];
    const ids = grouped.map((g) => g.operatorId).filter((x): x is string => x !== null);
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    // 每店员销量：一次轻量 findMany（仅 operatorId + items.quantity）后内存归组
    const qtyRows = await this.prisma.saleOrder.findMany({
      where,
      select: { operatorId: true, items: { select: { quantity: true } } },
    });
    const qtyByOperator = new Map<string | null, number>();
    for (const o of qtyRows) {
      const q = o.items.reduce((s, it) => s + it.quantity, 0);
      qtyByOperator.set(o.operatorId, (qtyByOperator.get(o.operatorId) ?? 0) + q);
    }

    return grouped.map((g) => ({
      operatorId: g.operatorId,
      operatorName: g.operatorId ? (nameById.get(g.operatorId) ?? null) : null,
      revenue: g._sum.totalAmount ?? 0,
      orders: g._count,
      quantity: qtyByOperator.get(g.operatorId) ?? 0,
    }));
  }

  private async windowStats(shopId: string, since: Date): Promise<SalesWindowStats> {
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

  // ---- 纯函数辅助（无 DB） ----------------------------------------------

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
    return Array.from({ length: maxIdx + 1 }, (_, i) => empty(`w${i}`, `第${i + 1}周`));
  }

  /** 某订单时间落在哪个桶 */
  private bucketKey(range: SalesRange, date: Date): string | null {
    if (range === "today") return null;
    if (range === "week") return `d${(date.getDay() + 6) % 7}`;
    return `w${Math.min(Math.floor((date.getDate() - 1) / 7), 4)}`;
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
