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

/** 常用尺码组（用于模板，加速杂款建档） */
export const COMMON_SIZE_GROUPS: Record<string, string[]> = {
  通用: ["S", "M", "L", "XL", "XXL"],
  均码: ["F"],
  数字裤装: ["28", "29", "30", "31", "32", "33", "34"],
  童装: ["100", "110", "120", "130", "140", "150"],
};
