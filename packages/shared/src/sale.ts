import { z } from "zod";
import { Money, SignedMoney, MAX_QTY } from "./product";
import { SaleOrderStatus } from "./enums";

export const SaleItemSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  skuId: z.string().uuid(),
  quantity: z.number().int().positive().max(MAX_QTY),
  price: Money, // 成交单价（分），可因折扣不同于 salePrice
  cost: Money, // 进价快照（分），PRD §7 规则 8
  subtotal: Money,
});
export type SaleItem = z.infer<typeof SaleItemSchema>;

export const SaleOrderSchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  operatorId: z.string().uuid().nullable(),
  status: SaleOrderStatus,
  /** 实收 = Σ各行subtotal - orderDiscountCents（分）；orderDiscountCents 为负即整单加价 */
  totalAmount: Money,
  /**
   * 整单优惠金额（分，默认0，可为负）。各行按原价入库，
   * 实收 = Σ各行subtotal - orderDiscountCents；负数 = 整单加价（总价改价高于原价合计）
   */
  orderDiscountCents: SignedMoney.default(0),
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
  quantity: z.number().int().positive().max(MAX_QTY),
  /** 成交单价（分）。留空则用 SKU 当前售价 */
  price: Money.optional(),
});
export type SaleItemInput = z.infer<typeof SaleItemInput>;

/** 提交一笔销售（扫码 → 购物车 → 结算） */
export const CreateSaleOrderInput = z.object({
  /** 客户端生成的幂等键，防止重复提交导致重复扣库存 */
  opId: z.string().min(1).max(64),
  items: z.array(SaleItemInput).min(1, "至少需要一件商品"),
  /**
   * 整单优惠金额（分，可选，留空=0，可为负）。各行仍按原价入库，
   * 订单实收 = Σ各行subtotal - orderDiscountCents；负数 = 整单加价（总价改价高于原价合计）
   */
  orderDiscountCents: SignedMoney.optional(),
});
export type CreateSaleOrderInput = z.infer<typeof CreateSaleOrderInput>;

/* ----------------------------- 编辑账单 DTO ----------------------------- */

/** 编辑账单中的一行：按 SaleItem.id 定位；quantity=0 表示删除该行，库存会回滚 */
export const EditSaleItemInput = z.object({
  id: z.string().uuid(),
  quantity: z.number().int().nonnegative().max(MAX_QTY),
  price: Money,
});
export type EditSaleItemInput = z.infer<typeof EditSaleItemInput>;

/**
 * 编辑账单：传入要调整的明细行（改价 / 改数量 / 删某件）。
 * 不支持往旧单加商品。库存按新旧差额自动回滚或扣减。
 */
export const EditSaleOrderInput = z.object({
  items: z.array(EditSaleItemInput).min(1),
});
export type EditSaleOrderInput = z.infer<typeof EditSaleOrderInput>;

/* --------------------- 销售记录 / 报表（服务端 → 客户端响应类型） --------------------- */

/** 单据明细行（含商品/规格名称，便于展示） */
export interface SaleItemDetail {
  id: string;
  skuId: string;
  quantity: number;
  price: number;
  /** 进价快照（分），PRD §7 规则 8。owner 可见，用于单据层面单件毛利展示 */
  cost: number;
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
  /** 整单优惠金额（分）。各行按原价入库，实收 = Σ各行subtotal - orderDiscountCents */
  orderDiscountCents: number;
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
  month: SalesWindowStats;
  /** 近 7 天热销榜 */
  topSkus: TopSkuStat[];
}

/* --------------------- 销售报表（含利润 + 日期下钻） --------------------- */

/** 报表时间档：今日 / 本周 / 本月 */
export type SalesRange = "today" | "week" | "month";

/** 一段时间的统计（含成本与毛利） */
export interface SalesStat {
  revenue: number; // 营业额（成交价合计，分）
  cost: number; // 成本（进价×数量合计，分）
  profit: number; // 毛利 = revenue - cost（分）
  orders: number; // 单数
  quantity: number; // 件数
}

/** 下钻桶：本周=每天，本月=每周 */
export interface SalesBucket {
  key: string; // 唯一键
  label: string; // 展示名，如「周一」「第1周」
  revenue: number;
  profit: number;
  orders: number;
  quantity: number;
}

/** 某店员在一段时间内的销售汇总 */
export interface OperatorSalesStat {
  operatorId: string | null;
  operatorName: string | null;
  revenue: number; // 营业额（分）
  orders: number; // 单数
  quantity: number; // 件数
}

/** 报表接口返回：合计 + 下钻桶 + 该时间档热销 + 各店员销售额 */
export interface SalesReport {
  range: SalesRange;
  total: SalesStat;
  /** 顺序从早到近；今日档为空数组 */
  buckets: SalesBucket[];
  topSkus: TopSkuStat[];
  /** 各店员在该时间档内的销售额，按营业额从高到低 */
  byOperator: OperatorSalesStat[];
}

/* --------------------- 历史每月销售（按天） --------------------- */

/** 某一天的销售汇总 */
export interface DailySalesStat {
  date: string; // YYYY-MM-DD（本地）
  revenue: number; // 营业额（分）
  profit: number; // 毛利（分）
  orders: number; // 单数
  quantity: number; // 件数
}

/** 历史某月报表：当月合计 + 各店员 + 每天明细（从 1 号到月末，由早到近） */
export interface MonthlySalesReport {
  year: number;
  month: number; // 1-12
  total: SalesStat;
  byOperator: OperatorSalesStat[];
  days: DailySalesStat[];
}

/* --------------------- 任意时间段报表（周/日下钻） --------------------- */

/**
 * 任意时间段报表：合计 + 各店员 + 该时段内全部订单流水（按时间倒序）。
 * 用于销售统计下钻视图（月 → 周 → 日）与环比（客户端另取上一期数据对比）。
 */
export interface RangeSalesReport {
  /** 起始日（含），YYYY-MM-DD（北京时间） */
  from: string;
  /** 结束日（含），YYYY-MM-DD（北京时间） */
  to: string;
  total: SalesStat;
  byOperator: OperatorSalesStat[];
  orders: SaleOrderDetail[];
}
