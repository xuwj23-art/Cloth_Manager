import { z } from "zod";
import { StockMovementType } from "./enums.js";

/**
 * 库存流水：库存以「增量累加」记录，而非覆盖绝对值。
 * 这是离线多端同步不丢数据、不错扣的关键设计。
 */
export const StockMovementSchema = z.object({
  id: z.string().uuid(),
  skuId: z.string().uuid(),
  type: StockMovementType,
  /** 变动量，带正负：入库为正、出库为负 */
  quantity: z.number().int(),
  /** 关联单据（如销售单 id），可空 */
  refOrderId: z.string().uuid().nullable(),
  operatorId: z.string().uuid().nullable(),
  /** 客户端生成的幂等键，重复上传不重复扣减 */
  opId: z.string().min(1).max(64),
  createdAt: z.string().datetime(),
});
export type StockMovement = z.infer<typeof StockMovementSchema>;

/** 创建库存变动（入库/盘点等） */
export const CreateStockMovementInput = z.object({
  skuId: z.string().uuid(),
  type: StockMovementType,
  quantity: z.number().int().refine((n) => n !== 0, "变动量不能为 0"),
  refOrderId: z.string().uuid().nullable().optional(),
  opId: z.string().min(1).max(64),
});
export type CreateStockMovementInput = z.infer<typeof CreateStockMovementInput>;
