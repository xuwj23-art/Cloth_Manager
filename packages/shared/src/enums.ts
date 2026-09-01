import { z } from "zod";

/** 用户角色：老板（管理员）/ 店员 */
export const UserRole = z.enum(["owner", "staff"]);
export type UserRole = z.infer<typeof UserRole>;

/** 库存流水类型 */
export const StockMovementType = z.enum([
  "in", // 入库 / 补货
  "out", // 出库 / 销售
  "adjust", // 盘点调整
  "transfer", // 调拨（远期多门店）
]);
export type StockMovementType = z.infer<typeof StockMovementType>;

/** 销售单状态 */
export const SaleOrderStatus = z.enum([
  "draft", // 草稿（购物车中）
  "completed", // 已完成
  "voided", // 已作废
]);
export type SaleOrderStatus = z.infer<typeof SaleOrderStatus>;
