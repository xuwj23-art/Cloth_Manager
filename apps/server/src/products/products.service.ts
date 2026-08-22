import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type {
  CatalogSyncResponse,
  CreateProductInput,
  ProductScope,
  UpdateProductInput,
} from "@cloth-scan/shared";
import { expandSkuMatrix, shouldArchive } from "@cloth-scan/shared";
import { PrismaService } from "../prisma/prisma.service";

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

  /** 生成 10 位纯数字条码（首位非 0），便于手动输入（数字键盘，无字母/横杠） */
  private genNumericBarcode(): string {
    let s = String(1 + Math.floor(Math.random() * 9));
    for (let i = 0; i < 9; i++) s += Math.floor(Math.random() * 10);
    return s;
  }

  /** 生成 count 个全局唯一的纯数字条码（查库去重 + 批内去重，冲突自动重试） */
  private async generateUniqueBarcodes(count: number): Promise<string[]> {
    if (count <= 0) return [];
    const result: string[] = [];
    const used = new Set<string>();
    while (result.length < count) {
      const batch: string[] = [];
      while (batch.length < count - result.length) {
        const c = this.genNumericBarcode();
        if (!used.has(c)) {
          used.add(c);
          batch.push(c);
        }
      }
      const existing = await this.prisma.sku.findMany({
        where: { barcode: { in: batch } },
        select: { barcode: true },
      });
      const taken = new Set(existing.map((e) => e.barcode));
      for (const c of batch) {
        if (!taken.has(c)) result.push(c);
      }
    }
    return result;
  }

  /** 新建商品款（含批量 SKU），杂款建档核心入口 */
  async createProduct(shopId: string, input: CreateProductInput) {
    // 仅为未显式带条码的 SKU 预生成唯一纯数字条码
    const generated = await this.generateUniqueBarcodes(
      input.skus.filter((s) => !s.barcode).length,
    );
    let gi = 0;

    try {
      return await this.prisma.product.create({
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
              barcode: s.barcode ?? generated[gi++]!,
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
    } catch (e) {
      // 跨进程并发建档撞条码（generateUniqueBarcodes 是 check-then-act）→ 409 提示重试
      if ((e as { code?: string })?.code === "P2002") {
        throw new ConflictException("条码冲突（与其他商品重复），请重试");
      }
      throw e;
    }
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
    const where: {
      shopId: string;
      deletedAt: null;
      archivedAt?: null | { not: null };
    } = {
      shopId,
      deletedAt: null, // 已删除的不出现在任何列表
    };
    if (scope === "active") where.archivedAt = null;
    else if (scope === "archived") where.archivedAt = { not: null };
    return this.prisma.product.findMany({
      where,
      include: { skus: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 增量同步专用查询（D2 + D3）。与 {@link listProducts} 的区别：
   * - 按 `since`（上次同步的 serverTime）过滤 updatedAt，仅返回变更过的商品（省流量/电量）
   * - 同时返回「自 since 起被软删」的商品下辖 SKU 条码（deletedBarcodes），
   *   供客户端清理本地 skus_cache（D3：原先 skus_cache 永不清理已删商品）
   * - 不再按 archivedAt 过滤：在售/已下架商品都要同步到客户端
   *
   * 软删除语义不变：服务端保留 Product/Sku 行与图片（历史账单仍可看图，PRD §7 规则 5），
   * 仅客户端缓存需要按 deletedBarcodes 删除。
   *
   * @param since ISO8601 时间戳；缺省时返回全量在售商品（首次同步）
   * @returns 满足 {@link CatalogSyncResponse} 形状；products 字段为 Prisma Product&
   *   {skus}（时间戳为 Date，HTTP JSON 序列化时自动转 ISO 字符串，与 listProducts 一致）
   */
  async listProductsForSync(shopId: string, since?: Date): Promise<CatalogSyncResponse> {
    // 1) 在售/已下架（未软删）商品的增量：updatedAt > since
    const productsWhere: {
      shopId: string;
      deletedAt: null;
      updatedAt?: { gt: Date };
    } = { shopId, deletedAt: null };
    if (since) productsWhere.updatedAt = { gt: since };
    const products = await this.prisma.product.findMany({
      where: productsWhere,
      include: { skus: true },
    });

    // 2) 软删商品的增量：deletedAt 非空 且 updatedAt > since
    //    仅取 SKU 条码（客户端缓存按 barcode 删除）
    const deletedWhere: {
      shopId: string;
      deletedAt: { not: null };
      updatedAt?: { gt: Date };
    } = { shopId, deletedAt: { not: null } };
    if (since) deletedWhere.updatedAt = { gt: since };
    const deleted = await this.prisma.product.findMany({
      where: deletedWhere,
      select: { skus: { select: { barcode: true } } },
    });
    const deletedBarcodes = deleted.flatMap((p) => p.skus.map((s) => s.barcode));

    // 3) serverTime = 当前时间，作为客户端下次请求的 since
    //    注意：取查询结束后的当前时间（而非 since+窗口）确保不会漏掉本次查询期间写入的数据
    return {
      products: products as unknown as CatalogSyncResponse["products"],
      deletedBarcodes,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * 删除商品（仅限已售罄/已下架）：软删除（置 deletedAt），从所有列表隐藏。
   * 保留 Product/Sku 行与图片：维持销售历史外键，历史账单仍能看到图片。
   */
  async deleteProduct(shopId: string, id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.shopId !== shopId || product.deletedAt) {
      throw new NotFoundException("商品不存在");
    }
    if (!product.archivedAt) {
      throw new BadRequestException("请先让商品售罄或手动下架后再删除");
    }

    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { ok: true };
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
    if (product.deletedAt) {
      throw new NotFoundException("商品已删除，无法编辑");
    }

    return this.prisma.$transaction(async (tx) => {
      // 事务内重读 SKU，避免与并发开单/编辑竞态导致 adjust 流水 delta 用陈旧库存计算
      const freshSkus = await tx.sku.findMany({ where: { productId: id } });
      const freshById = new Map(freshSkus.map((k) => [k.id, k]));

      if (input.name !== undefined || input.coverImage !== undefined) {
        await tx.product.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.coverImage !== undefined ? { coverImage: input.coverImage } : {}),
          },
        });
      }

      let stockChanged = false;
      for (const s of input.skus ?? []) {
        const existing = freshById.get(s.id);
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
    if (product.deletedAt) {
      throw new NotFoundException("商品已删除，无法操作");
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
   *
   * 归档判定逻辑抽到 shared 的 {@link shouldArchive}，前端可复用同一语义。
   */
  async recomputeArchive(tx: Prisma.TransactionClient, productId: string): Promise<void> {
    const agg = await tx.sku.aggregate({
      where: { productId },
      _sum: { stock: true },
    });
    const totalStock = agg._sum.stock ?? 0;
    const p = await tx.product.findUnique({
      where: { id: productId },
      select: { archivedAt: true, deletedAt: true },
    });
    // 当前归档态归一化为 ISO 字符串（Prisma 返回 Date | null）
    const archivedAt =
      p?.archivedAt instanceof Date ? p.archivedAt.toISOString() : (p?.archivedAt ?? null);
    const deletedAt =
      p?.deletedAt instanceof Date ? p.deletedAt.toISOString() : (p?.deletedAt ?? null);

    const newArchivedAt = shouldArchive({ totalStock, archivedAt, deletedAt });
    if (newArchivedAt !== archivedAt) {
      await tx.product.update({
        where: { id: productId },
        data: {
          archivedAt: newArchivedAt === null ? null : new Date(newArchivedAt),
        },
      });
    }
  }

  /** 扫码匹配：通过 QR/条码查 SKU 及其所属款（店铺端核心，仅限本门店） */
  async findByBarcode(shopId: string, barcode: string) {
    const sku = await this.prisma.sku.findUnique({
      where: { barcode },
      include: { product: true },
    });
    if (!sku || sku.product.shopId !== shopId || sku.product.deletedAt) {
      throw new NotFoundException(`未找到条码对应的商品：${barcode}`);
    }
    return sku;
  }
}
