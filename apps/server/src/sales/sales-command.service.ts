import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CreateSaleOrderInput, EditSaleOrderInput, SaleOrderDetail } from "@cloth-scan/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ProductsService } from "../products/products.service";

/**
 * Prisma/PG 的 Int 字段上限（price/subtotal/totalAmount 均为 Int4）。
 * 共享校验器已限 Money≤10亿、quantity≤9999，但 price×quantity 相乘仍可能越界，
 * 在服务端提前拦截为 400（否则 PG 抛 integer out of range → 500 → 离线单永久卡 pending）。
 */
const INT32_MAX = 2_147_483_647;

/**
 * 销售写操作（命令侧）：createSale / editOrder / deleteOrder。
 *
 * 这一层承载 Wave 2 的全部并发/一致性保证（PRD §7 不变式），拆分时仅做代码移动，
 * 不改动任何写行为：
 *  - 金额用分（Int）
 *  - 库存走流水（stockMovement）
 *  - opId 幂等（P2002 / P2034 catch 保留）
 *  - 防超卖（updateMany + stock>=qty 原子条件更新 + Serializable 隔离保留）
 *  - 软删除（voided + deletedAt 保留）
 *  - 门店隔离（product.shopId 关系过滤保留）
 *  - 进价快照（saleItem.cost 保留）
 *  - 售罄归档（products.recomputeArchive 调用保留）
 *  - 整单优惠（orderDiscountCents：各行按原价入库，实收 = Σsubtotal - discount；
 *    正数=减免且不得使实收为负，负数=整单加价即总价改价高于原价合计）
 *
 * 只读查询见 SalesReportService。
 */
@Injectable()
export class SalesCommandService {
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
  async createSale(shopId: string, operatorId: string | null, input: CreateSaleOrderInput) {
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
            if (subtotal > INT32_MAX) {
              throw new BadRequestException(
                `金额过大：${sku!.barcode} 单价 ${price} 分 × 数量 ${item.quantity} 超出系统上限`,
              );
            }
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
          // totalAmount 即实收 = Σ各行subtotal - orderDiscountCents。
          // 正优惠不得使实收为负；负数 = 整单加价（总价改价可高于原价合计），放行。
          const orderDiscountCents = input.orderDiscountCents ?? 0;
          if (orderDiscountCents > total) {
            throw new BadRequestException(
              `整单优惠（${orderDiscountCents} 分）不能超过原价合计（${total} 分）`,
            );
          }
          const paidAmount = total - orderDiscountCents;
          if (total > INT32_MAX || paidAmount > INT32_MAX) {
            throw new BadRequestException("整单金额超出系统上限，请分单结算");
          }

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

          // E7：库存流水批量化——原逐条 tx.stockMovement.create 循环 N 次往返，
          // 改为一次 createMany 批量插入。仍在同一 Serializable 事务内，幂等/防超卖/原子性不变。
          // opId 每条独立 randomUUID（流水 opId 仅用于本条去重日志，与订单级 opId 不同语义）。
          if (itemsData.length > 0) {
            await tx.stockMovement.createMany({
              data: itemsData.map((item) => ({
                skuId: item.skuId,
                type: "out" as const,
                quantity: -item.quantity,
                refOrderId: order.id,
                operatorId,
                opId: randomUUID(),
              })),
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
      const isIdempotencyRace = code === "P2002" || code === "P2034";
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
        // 门店隔离：opId 全局唯一，若命中的是别店的同 opId 单，不能跨店返回
        if (existing && existing.shopId === shopId) return existing;
        // P2034 但无同 opId 单：真并发冲突（非幂等重复），向上抛由调用方重试
      }
      throw e;
    }
  }

  /**
   * 删除整单（误操作兜底）：软删除——把每件已扣的库存加回、删除该单的库存出库流水，
   * 然后把单据置为 voided + 写 deletedAt（保留行 + 明细作为审计痕迹，不级联删 SaleItem）。
   * 所有报表/流水查询过滤 status=completed + deletedAt=null，使已删单对前台不可见。
   * 事务保证一致。
   */
  async deleteOrder(shopId: string, id: string): Promise<{ ok: true }> {
    await this.prisma.$transaction(
      async (tx) => {
        // 终态守卫：条件更新抢占 completed→voided 终态。
        // 重复删除（超时重试/双击/双设备）只有第一次 count===1，后续直接 404，
        // 防止库存被重复加回（虚增）。
        const claimed = await tx.saleOrder.updateMany({
          where: { id, shopId, status: "completed", deletedAt: null },
          data: { status: "voided", deletedAt: new Date() },
        });
        if (claimed.count !== 1) {
          throw new NotFoundException("单据不存在");
        }
        // 单据读取移入事务内，避免与并发编辑/删除竞态（TOCTOU）
        const order = await tx.saleOrder.findUnique({
          where: { id },
          include: { items: true },
        });
        if (!order) {
          throw new NotFoundException("单据不存在");
        }
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
        for (const productId of affected) {
          await this.products.recomputeArchive(tx, productId);
        }
      },
      // 与 editOrder 一致：写命令用 Serializable，并发删/编冲突会中止其中一方
      { isolationLevel: "Serializable" },
    );

    return { ok: true };
  }

  /**
   * 编辑账单：改价 / 改数量 / 删某件（quantity=0）。不支持加商品。
   * 库存按新旧数量差额回滚或扣减（扣减时校验库存）；总价与售罄状态同步刷新。
   * 若改后全单为空，则整单删除。
   *
   * 注意：编辑完成后回读详情走 SalesReportService.getOrder（只读路径）。
   * 此处保留对 PrismaService 的直接回查以避免命令/报表服务双向依赖。
   */
  async editOrder(shopId: string, id: string, input: EditSaleOrderInput): Promise<SaleOrderDetail> {
    await this.prisma.$transaction(
      async (tx) => {
        // 事务内重读 + 终态守卫：已作废/已软删的单不可编辑
        // （此前仅校验存在性，对已删单 PATCH 会改完库存后才在回读时 404）
        const order = await tx.saleOrder.findUnique({
          where: { id },
          include: { items: { include: { sku: true } } },
        });
        if (
          !order ||
          order.shopId !== shopId ||
          order.status === "voided" ||
          order.deletedAt !== null
        ) {
          throw new NotFoundException("单据不存在");
        }
        const byId = new Map(order.items.map((it) => [it.id, it]));
        for (const r of input.items) {
          if (!byId.has(r.id)) {
            throw new NotFoundException(`明细不存在：${r.id}`);
          }
        }
        const affected = new Set<string>();
        // E7：库存流水先收集，循环结束后一次 createMany 批量插入
        const movementData: {
          skuId: string;
          type: "adjust";
          quantity: number;
          refOrderId: string;
          opId: string;
        }[] = [];
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
            movementData.push({
              skuId: existing.skuId,
              type: "adjust",
              quantity: -delta,
              refOrderId: id,
              opId: randomUUID(),
            });
          }
          if (r.quantity === 0) {
            await tx.saleItem.delete({ where: { id: r.id } });
          } else {
            if (r.price * r.quantity > INT32_MAX) {
              throw new BadRequestException(
                `金额过大：单价 ${r.price} 分 × 数量 ${r.quantity} 超出系统上限`,
              );
            }
            await tx.saleItem.update({
              where: { id: r.id },
              data: { quantity: r.quantity, price: r.price, subtotal: r.price * r.quantity },
            });
          }
        }

        // 库存流水批量写入（仍在 Serializable 事务内）
        if (movementData.length > 0) {
          await tx.stockMovement.createMany({ data: movementData });
        }

        // 重算实收：各行 subtotal 之和 - 该单已记录的 orderDiscountCents
        const remaining = await tx.saleItem.findMany({ where: { orderId: id } });
        if (remaining.length === 0) {
          throw new BadRequestException("账单不能为空，请保留至少一件商品，或使用「删除整单」");
        }
        const subtotalSum = remaining.reduce((s, it) => s + it.subtotal, 0);
        // 编辑不改优惠金额；正优惠改后若使实收为负则夹到 0。
        // 负优惠（加价单）实收 = subtotalSum + |disc|，恒为正，无需夹取。
        const disc = order.orderDiscountCents ?? 0;
        const paidAmount = Math.max(0, subtotalSum - disc);
        // 与 createSale 对齐：totalAmount 是 Int4，单行各自合法但多行求和可能越界
        if (paidAmount > INT32_MAX) {
          throw new BadRequestException("整单金额超出系统上限，请分单结算");
        }
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

    return this.refetchDetail(shopId, id);
  }

  /**
   * 编辑后回读详情（软删单视为不存在）。内联实现以避免 Command→Report 循环依赖；
   * 行为与 SalesReportService.getOrder 完全一致。
   */
  private async refetchDetail(shopId: string, id: string): Promise<SaleOrderDetail> {
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
    return {
      id: order.id,
      shopId: order.shopId,
      operatorId: order.operatorId,
      operatorName: order.operator?.name ?? null,
      status: order.status as SaleOrderDetail["status"],
      totalAmount: order.totalAmount,
      orderDiscountCents: order.orderDiscountCents,
      itemCount: order.items.reduce((s, it) => s + it.quantity, 0),
      createdAt: order.createdAt.toISOString(),
      items: order.items.map((it) => ({
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
