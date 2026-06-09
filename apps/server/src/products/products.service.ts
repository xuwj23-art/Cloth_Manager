import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  CreateProductInput,
  ProductScope,
  UpdateProductInput,
} from "@cloth-scan/shared";
import { expandSkuMatrix } from "@cloth-scan/shared";
import { PrismaService } from "../prisma/prisma.service";

/** Prisma 事务客户端（$transaction 回调参数）。用宽松类型避免引入庞大的生成类型。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = any;

/** 新手「一键体验」的演示商品模板 */
const DEMO_PRODUCTS = [
  {
    name: "纯棉圆领T恤",
    colors: ["白", "黑"],
    sizes: ["M", "L"],
    costPrice: 2000,
    salePrice: 5900,
    initialStock: 20,
  },
  {
    name: "修身牛仔裤",
    colors: ["蓝"],
    sizes: ["29", "30", "31"],
    costPrice: 5000,
    salePrice: 12900,
    initialStock: 15,
  },
  {
    name: "连帽卫衣",
    colors: ["灰", "藏青"],
    sizes: ["M", "L", "XL"],
    costPrice: 6000,
    salePrice: 15900,
    initialStock: 10,
  },
];

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 为 SKU 生成全局唯一编号（QR 内容）。门店前缀 + 短随机串。 */
  private generateBarcode(shopId: string): string {
    const prefix = shopId.replace(/-/g, "").slice(0, 4).toUpperCase();
    const rand = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
    return `${prefix}-${rand}`;
  }

  /** 新建商品款（含批量 SKU），杂款建档核心入口 */
  async createProduct(shopId: string, input: CreateProductInput) {
    return this.prisma.product.create({
      data: {
        shopId,
        name: input.name,
        categoryId: input.categoryId ?? null,
        coverImage: input.coverImage ?? null,
        images: input.images ?? [],
        skus: {
          create: input.skus.map((s) => ({
            color: s.color,
            size: s.size,
            barcode: s.barcode ?? this.generateBarcode(shopId),
            costPrice: s.costPrice,
            salePrice: s.salePrice,
            stock: s.initialStock ?? 0,
            movements:
              (s.initialStock ?? 0) > 0
                ? {
                    create: {
                      type: "in",
                      quantity: s.initialStock ?? 0,
                      opId: randomUUID(),
                    },
                  }
                : undefined,
          })),
        },
      },
      include: { skus: true },
    });
  }

  /**
   * 新手「一键体验」：为空门店灌入演示商品（含库存）。
   * 幂等保护：门店已有商品时不再灌入，返回 created=0。
   */
  async seedDemo(shopId: string) {
    const count = await this.prisma.product.count({ where: { shopId } });
    if (count > 0) {
      return { created: 0, products: [] };
    }
    const products = [];
    for (const d of DEMO_PRODUCTS) {
      const skus = expandSkuMatrix({
        colors: d.colors,
        sizes: d.sizes,
        costPrice: d.costPrice,
        salePrice: d.salePrice,
        initialStock: d.initialStock,
      });
      products.push(await this.createProduct(shopId, { name: d.name, skus }));
    }
    return { created: products.length, products };
  }

  async listProducts(shopId: string, scope: ProductScope = "active") {
    const where: { shopId: string; archivedAt?: null | { not: null } } = {
      shopId,
    };
    if (scope === "active") where.archivedAt = null;
    else if (scope === "archived") where.archivedAt = { not: null };
    return this.prisma.product.findMany({
      where,
      include: { skus: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /** 编辑商品：改名/改封面/改价/盘点改库存（库存差额写 adjust 流水），并刷新售罄归档状态 */
  async updateProduct(shopId: string, id: string, input: UpdateProductInput) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { skus: true },
    });
    if (!product || product.shopId !== shopId) {
      throw new NotFoundException("商品不存在");
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.name !== undefined || input.coverImage !== undefined) {
        await tx.product.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.coverImage !== undefined
              ? { coverImage: input.coverImage }
              : {}),
          },
        });
      }

      let stockChanged = false;
      for (const s of input.skus ?? []) {
        const existing = product.skus.find((k) => k.id === s.id);
        if (!existing) {
          throw new NotFoundException(`SKU 不存在：${s.id}`);
        }
        const data: Record<string, unknown> = {};
        if (s.costPrice !== undefined) data.costPrice = s.costPrice;
        if (s.salePrice !== undefined) data.salePrice = s.salePrice;
        if (s.stock !== undefined && s.stock !== existing.stock) {
          const delta = s.stock - existing.stock;
          await tx.stockMovement.create({
            data: {
              skuId: s.id,
              type: "adjust",
              quantity: delta,
              opId: randomUUID(),
            },
          });
          data.stock = s.stock;
          data.version = { increment: 1 };
          stockChanged = true;
        }
        if (Object.keys(data).length > 0) {
          await tx.sku.update({ where: { id: s.id }, data });
        }
      }

      if (stockChanged) {
        await this.recomputeArchive(tx, id);
      }
      return tx.product.findUnique({ where: { id }, include: { skus: true } });
    });
  }

  /** 手动下架 / 恢复 */
  async setArchived(shopId: string, id: string, archived: boolean) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.shopId !== shopId) {
      throw new NotFoundException("商品不存在");
    }
    return this.prisma.product.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
      include: { skus: true },
    });
  }

  /**
   * 根据当前总库存刷新归档状态：总库存为 0 自动下架（售罄归档），
   * 重新有货则自动恢复在售。可在事务内调用（销售扣减后、盘点改库存后）。
   */
  async recomputeArchive(tx: TxClient, productId: string): Promise<void> {
    const agg = await tx.sku.aggregate({
      where: { productId },
      _sum: { stock: true },
    });
    const total = agg._sum.stock ?? 0;
    const p = await tx.product.findUnique({
      where: { id: productId },
      select: { archivedAt: true },
    });
    if (total <= 0 && !p?.archivedAt) {
      await tx.product.update({
        where: { id: productId },
        data: { archivedAt: new Date() },
      });
    } else if (total > 0 && p?.archivedAt) {
      await tx.product.update({
        where: { id: productId },
        data: { archivedAt: null },
      });
    }
  }

  /** 扫码匹配：通过 QR/条码查 SKU 及其所属款（店铺端核心，仅限本门店） */
  async findByBarcode(shopId: string, barcode: string) {
    const sku = await this.prisma.sku.findUnique({
      where: { barcode },
      include: { product: true },
    });
    if (!sku || sku.product.shopId !== shopId) {
      throw new NotFoundException(`未找到条码对应的商品：${barcode}`);
    }
    return sku;
  }
}
