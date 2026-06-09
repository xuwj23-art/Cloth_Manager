import type { CreateSaleOrderInput } from "./sale.js";

/** 购物车中的一行（一个 SKU） */
export interface CartLine {
  skuId: string;
  barcode: string;
  productName: string;
  color: string;
  size: string;
  price: number; // 成交单价（分）
  quantity: number;
  stock: number; // 可售库存（用于上限保护）
}

/** 可加入购物车的 SKU 信息（来自扫码/本地缓存） */
export interface ScannedSku {
  skuId: string;
  barcode: string;
  productName: string;
  color: string;
  size: string;
  price: number;
  stock: number;
}

/**
 * 按指定数量加入购物车：已存在则累加（不超过库存），否则新增一行。
 * 返回新数组（不可变更新）。qty 会被夹在 1 以上、库存以下。
 */
export function addToCartQty(
  lines: CartLine[],
  sku: ScannedSku,
  qty: number,
): CartLine[] {
  const safeQty = Math.max(1, Math.floor(qty));
  const idx = lines.findIndex((l) => l.skuId === sku.skuId);
  if (idx >= 0) {
    const line = lines[idx]!;
    const nextQty = Math.min(line.quantity + safeQty, Math.max(sku.stock, 0));
    const copy = lines.slice();
    copy[idx] = { ...line, quantity: nextQty, stock: sku.stock, price: sku.price };
    return copy;
  }
  if (sku.stock <= 0) return lines; // 无库存不加入
  return [
    ...lines,
    {
      skuId: sku.skuId,
      barcode: sku.barcode,
      productName: sku.productName,
      color: sku.color,
      size: sku.size,
      price: sku.price,
      quantity: Math.min(safeQty, sku.stock),
      stock: sku.stock,
    },
  ];
}

/**
 * 加入购物车：已存在则数量 +1（不超过库存），否则新增一行。
 * 返回新数组（不可变更新）。
 */
export function addToCart(lines: CartLine[], sku: ScannedSku): CartLine[] {
  return addToCartQty(lines, sku, 1);
}

/** 设置某行数量（夹在 0..stock；为 0 则移除） */
export function setQuantity(
  lines: CartLine[],
  skuId: string,
  quantity: number,
): CartLine[] {
  return lines
    .map((l) =>
      l.skuId === skuId
        ? { ...l, quantity: Math.min(Math.max(quantity, 0), l.stock) }
        : l,
    )
    .filter((l) => l.quantity > 0);
}

export function removeFromCart(lines: CartLine[], skuId: string): CartLine[] {
  return lines.filter((l) => l.skuId !== skuId);
}

/** 修改某行的成交单价（分），用于讨价还价/优惠。负数按 0 处理。 */
export function setLinePrice(
  lines: CartLine[],
  skuId: string,
  price: number,
): CartLine[] {
  const safe = Math.max(0, Math.round(price));
  return lines.map((l) => (l.skuId === skuId ? { ...l, price: safe } : l));
}

/** 合计金额（分） */
export function cartTotalCents(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
}

/** 购物车件数合计 */
export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** 转换为下单入参（带幂等 opId） */
export function cartToSaleInput(
  lines: CartLine[],
  opId: string,
): CreateSaleOrderInput {
  return {
    opId,
    items: lines.map((l) => ({
      skuId: l.skuId,
      quantity: l.quantity,
      price: l.price,
    })),
  };
}
