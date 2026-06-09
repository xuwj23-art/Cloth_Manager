import { z } from "zod";
import { Money } from "./product.js";
import { SaleOrderStatus } from "./enums.js";

export const SaleItemSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  skuId: z.string().uuid(),
  quantity: z.number().int().positive(),
  price: Money, // 成交单价（分），可因折扣不同于 salePrice
  subtotal: Money,
});
export type SaleItem = z.infer<typeof SaleItemSchema>;

export const SaleOrderSchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  operatorId: z.string().uuid().nullable(),
  status: SaleOrderStatus,
  totalAmount: Money,
  createdAt: z.string().datetime(),
});
export type SaleOrder = z.infer<typeof SaleOrderSchema>;

export const SaleOrderWithItemsSchema = SaleOrderSchema.extend({
  items: z.array(SaleItemSchema),
});
export type SaleOrderWithItems = z.infer<typeof SaleOrderWithItemsSchema>;

/* ----------------------------- 开单输入 DTO ----------------------------- */

export const SaleItemInput = z.object({
  skuId: z.string().uuid(),
  quantity: z.number().int().positive(),
  /** 成交单价（分）。留空则用 SKU 当前售价 */
  price: Money.optional(),
});
export type SaleItemInput = z.infer<typeof SaleItemInput>;

/** 提交一笔销售（扫码 → 购物车 → 结算） */
export const CreateSaleOrderInput = z.object({
  /** 客户端生成的幂等键，防止重复提交导致重复扣库存 */
  opId: z.string().min(1).max(64),
  items: z.array(SaleItemInput).min(1, "至少需要一件商品"),
});
export type CreateSaleOrderInput = z.infer<typeof CreateSaleOrderInput>;

/* --------------------- 销售记录 / 报表（服务端 → 客户端响应类型） --------------------- */

/** 单据明细行（含商品/规格名称，便于展示） */
export interface SaleItemDetail {
  id: string;
  skuId: string;
  quantity: number;
  price: number;
  subtotal: number;
  productName: string;
  color: string;
  size: string;
  barcode: string;
  coverImage: string | null;
}

/** 销售单（列表/详情，含明细与操作人） */
export interface SaleOrderDetail {
  id: string;
  shopId: string;
  operatorId: string | null;
  operatorName: string | null;
  status: SaleOrderStatus;
  totalAmount: number;
  itemCount: number;
  createdAt: string;
  items: SaleItemDetail[];
}

/** 一段时间窗口的汇总指标 */
export interface SalesWindowStats {
  revenue: number; // 营业额（分）
  orders: number; // 单数
  quantity: number; // 销售件数
}

/** 热销 SKU 排行项 */
export interface TopSkuStat {
  skuId: string;
  productName: string;
  color: string;
  size: string;
  barcode: string;
  quantity: number;
  revenue: number;
}

/** 销售报表汇总 */
export interface SalesSummary {
  today: SalesWindowStats;
  week: SalesWindowStats;
  /** 近 7 天热销榜 */
  topSkus: TopSkuStat[];
}
