import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  CreateSaleOrderInput,
  SaleOrderDetail,
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

  /** 销售流水（最近 100 笔），含明细名称与操作人 */
  async listOrders(shopId: string): Promise<SaleOrderDetail[]> {
    const orders = await this.prisma.saleOrder.findMany({
      where: { shopId },
      include: {
        operator: true,
        items: { include: { sku: { include: { product: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return orders.map((o) => this.toDetail(o));
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

  /** 报表汇总：今日/本周营业额、单数、销量 + 近 7 天热销榜 */
  async getSummary(shopId: string): Promise<SalesSummary> {
    const [today, week, topSkus] = await Promise.all([
      this.windowStats(shopId, startOfToday()),
      this.windowStats(shopId, startOfWeek()),
      this.topSkus(shopId, startOfWeek()),
    ]);
    return { today, week, topSkus };
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
