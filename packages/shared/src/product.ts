import { z } from "zod";

/**
 * 金额：以「分」为单位的整数，避免浮点误差。
 * 上限 10 亿元（分）＝ 1000 万元：远超真实服装单价，同时防止极端输入
 * 溢出 Prisma/PG 的 32 位 Int（price×quantity 相乘也不至于超 Int32）。
 */
export const Money = z.number().int().nonnegative().max(1_000_000_000);

/** 单行数量上限：防呆（扫码/键盘误输多位数），远超真实单笔购买量 */
export const MAX_QTY = 9_999;

/** SKU = 款 + 颜色 + 尺码 的唯一组合，是库存与 QR 的核心键 */
export const SkuSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  color: z.string().min(1).max(40),
  size: z.string().min(1).max(20),
  /** QR 内容 / 条码：全局唯一 */
  barcode: z.string().min(1).max(64),
  costPrice: Money, // 进价（分）
  salePrice: Money, // 售价（分）
  stock: z.number().int(), // 当前库存（允许负数仅用于异常排查，业务上禁止负库存出库）
  version: z.number().int().nonnegative(), // 乐观锁 / 同步版本
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Sku = z.infer<typeof SkuSchema>;

/** 商品款（SPU） */
export const ProductSchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  name: z.string().min(1).max(80),
  categoryId: z.string().uuid().nullable(),
  coverImage: z.string().max(512).nullable(),
  images: z.array(z.string().max(512)).default([]),
  /** 材质名（芯片或自定义，展示用；不参与 SKU） */
  material: z.string().max(40).nullable().optional(),
  /** 品类名（芯片或自定义，展示用；与 categoryId 并存） */
  categoryName: z.string().max(40).nullable().optional(),
  /** 软下架/归档时间（null = 在售） */
  archivedAt: z.string().datetime().nullable().optional(),
  /** 软删除时间（null = 未删除）。已删除的商品永不复活（PRD §7 规则 5） */
  deletedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Product = z.infer<typeof ProductSchema>;

/** 商品款 + 其 SKU 列表（详情/卡片展示用） */
export const ProductWithSkusSchema = ProductSchema.extend({
  skus: z.array(SkuSchema),
});
export type ProductWithSkus = z.infer<typeof ProductWithSkusSchema>;

/**
 * 增量同步响应（D2 + D3）。
 * - products: 自 since 起 updatedAt 有变更的「在售/已下架」商品（用于 upsert）
 * - deletedBarcodes: 自 since 起被软删的商品下辖 SKU 条码（客户端据此清理本地缓存）
 * - serverTime: 本次响应的服务端时间（ISO8601），作为下次请求的 since
 *
 * 首次同步（since 缺省）: products 返回全量在售商品、deletedBarcodes 为空。
 */
export interface CatalogSyncResponse {
  products: ProductWithSkus[];
  deletedBarcodes: string[];
  serverTime: string;
}

/* ----------------------------- 建档输入 DTO ----------------------------- */

/** 单个 SKU 的录入项（颜色/尺码/价格/初始库存） */
export const CreateSkuInput = z.object({
  color: z.string().min(1).max(40),
  size: z.string().min(1).max(20),
  costPrice: Money,
  salePrice: Money,
  initialStock: z.number().int().nonnegative().default(0),
  /** 留空则由后端自动生成唯一编号；填则绑定现有吊牌条码 */
  barcode: z.string().min(1).max(64).optional(),
});
export type CreateSkuInput = z.infer<typeof CreateSkuInput>;

/** 新建商品款（含批量 SKU），杂款建档的核心入口 */
export const CreateProductInput = z.object({
  name: z.string().min(1).max(80),
  categoryId: z.string().uuid().nullable().optional(),
  coverImage: z.string().max(512).nullable().optional(),
  images: z.array(z.string().max(512)).max(9).optional(),
  material: z.string().max(40).optional(),
  categoryName: z.string().max(40).optional(),
  skus: z.array(CreateSkuInput).min(1, "至少需要一个 SKU"),
});
export type CreateProductInput = z.infer<typeof CreateProductInput>;

/* ----------------------------- 编辑商品 DTO ----------------------------- */

/** 编辑单个已存在 SKU 的价格/库存 */
export const UpdateSkuInput = z.object({
  id: z.string().uuid(),
  costPrice: Money.optional(),
  salePrice: Money.optional(),
  /** 目标库存（盘点修正）。与现有库存的差额会写一条 adjust 流水 */
  stock: z.number().int().nonnegative().optional(),
});
export type UpdateSkuInput = z.infer<typeof UpdateSkuInput>;

/** 编辑商品款：可改名称、改价、调库存（不在此处增删 SKU） */
export const UpdateProductInput = z.object({
  name: z.string().min(1).max(80).optional(),
  coverImage: z.string().max(512).nullable().optional(),
  images: z.array(z.string().max(512)).max(9).optional(),
  material: z.string().max(40).nullable().optional(),
  categoryName: z.string().max(40).nullable().optional(),
  skus: z.array(UpdateSkuInput).optional(),
});
export type UpdateProductInput = z.infer<typeof UpdateProductInput>;

/** 商品列表查询范围 */
export type ProductScope = "active" | "archived" | "all";

/**
 * 批量生成 SKU 组合：选「颜色集合 × 尺码集合」自动展开。
 * 例：colors=["红","蓝"], sizes=["S","M","L"] => 6 个 SKU
 */
export function expandSkuMatrix(params: {
  colors: string[];
  sizes: string[];
  costPrice: number;
  salePrice: number;
  initialStock?: number;
}): CreateSkuInput[] {
  const { colors, sizes, costPrice, salePrice, initialStock = 0 } = params;
  const result: CreateSkuInput[] = [];
  for (const color of colors) {
    for (const size of sizes) {
      result.push({ color, size, costPrice, salePrice, initialStock });
    }
  }
  return result;
}

/**
 * 判断商品当前是否应处于「已归档/售罄」状态（PRD §7 规则 7）。
 * - 已删除（deletedAt 非空）→ 不复活，返回当前 archivedAt 状态
 * - 总库存 <= 0 且未归档 → 应归档（返回当前时间戳 ISO）
 * - 总库存 > 0 且已归档 → 应恢复（返回 null）
 * - 否则保持现状（返回当前 archivedAt）
 *
 * 前后端共用，确保归档语义一致（PRD §7 规则 5：软删除不复活）。
 */
export function shouldArchive(opts: {
  totalStock: number;
  archivedAt: string | null;
  deletedAt: string | null;
}): string | null {
  if (opts.deletedAt) return opts.archivedAt; // 已删不复活
  if (opts.totalStock <= 0 && !opts.archivedAt) return new Date().toISOString(); // 售罄归档
  if (opts.totalStock > 0 && opts.archivedAt) return null; // 补货恢复
  return opts.archivedAt; // 保持
}
