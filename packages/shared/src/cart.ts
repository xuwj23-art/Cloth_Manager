import type { CreateSaleOrderInput } from "./sale";
import { memberPriceToTagPrice } from "./product";

/** 购物车中的一行（一个 SKU） */
export interface CartLine {
  skuId: string;
  barcode: string;
  productName: string;
  color: string;
  size: string;
  price: number; // 成交单价（分）
  /** 进车时的基准价（分）＝当前会员态下的默认价；改价后保留，用于展示划线与「恢复」 */
  origPrice?: number;
  /** 会员价（分）＝ SKU.salePrice 快照。会员态基准价；缺失时回退 price */
  memberPrice?: number;
  /** 商品主图路径（/uploads/…，可空）。购物车缩略图与预览弹层用 */
  image?: string | null;
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
  /** 会员价（分）＝ SKU.salePrice。由收银侧按会员与否决定 price 用会员价还是原价 */
  memberPrice?: number;
  stock: number;
  /** 商品主图路径（/uploads/…，可空） */
  image?: string | null;
}

/**
 * 按指定数量加入购物车：已存在则累加（不超过库存），否则新增一行。
 * 返回新数组（不可变更新）。qty 会被夹在 1 以上、库存以下。
 *
 * 已存在的行只更新数量与最新库存，**保留行上已议价的成交单价**
 * （否则收银员改价后再扫一件同款，整行会被静默改回吊牌价）。
 */
export function addToCartQty(lines: CartLine[], sku: ScannedSku, qty: number): CartLine[] {
  const safeQty = Math.max(1, Math.floor(qty));
  const idx = lines.findIndex((l) => l.skuId === sku.skuId);
  if (idx >= 0) {
    const line = lines[idx]!;
    const nextQty = Math.min(line.quantity + safeQty, Math.max(sku.stock, 0));
    const copy = lines.slice();
    copy[idx] = {
      ...line,
      quantity: nextQty,
      stock: sku.stock,
      // 会员价是参考信息（非议价结果），重扫时用最新快照刷新
      memberPrice: sku.memberPrice ?? line.memberPrice,
      image: sku.image ?? line.image ?? null,
    };
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
      origPrice: sku.price,
      memberPrice: sku.memberPrice ?? sku.price,
      image: sku.image ?? null,
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
export function setQuantity(lines: CartLine[], skuId: string, quantity: number): CartLine[] {
  return lines
    .map((l) =>
      l.skuId === skuId ? { ...l, quantity: Math.min(Math.max(quantity, 0), l.stock) } : l,
    )
    .filter((l) => l.quantity > 0);
}

export function removeFromCart(lines: CartLine[], skuId: string): CartLine[] {
  return lines.filter((l) => l.skuId !== skuId);
}

/** 修改某行的成交单价（分），用于讨价还价/优惠。负数按 0 处理。 */
export function setLinePrice(lines: CartLine[], skuId: string, price: number): CartLine[] {
  const safe = Math.max(0, Math.round(price));
  return lines.map((l) => (l.skuId === skuId ? { ...l, price: safe } : l));
}

/** 行的会员价（分）：快照缺失时回退成交价 */
export function lineMemberPrice(line: CartLine): number {
  return line.memberPrice ?? line.price;
}

/** 行的基准价（分）：会员态 = 会员价；非会员态 = 原价（会员价 ÷ 0.8 四舍五入到元） */
export function lineBasePrice(line: CartLine, isMember: boolean): number {
  const member = lineMemberPrice(line);
  return isMember ? member : memberPriceToTagPrice(member);
}

/**
 * 切换会员态后重算各行：
 * - 未手动改价的行（price === 切换前基准）：成交价与基准价都重置为新基准；
 * - 手动改过价的行：保留成交价，仅把基准价（origPrice）更新为新态基准，
 *   保证划线展示与「恢复」始终对齐当前会员态。
 */
export function rebaseMemberLines(lines: CartLine[], isMember: boolean): CartLine[] {
  return lines.map((l) => {
    const toBase = lineBasePrice(l, isMember);
    const fromBase = lineBasePrice(l, !isMember);
    if (l.price !== fromBase) return { ...l, origPrice: toBase };
    return { ...l, price: toBase, origPrice: toBase };
  });
}

/** 合计金额（分） */
export function cartTotalCents(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
}

/**
 * 整单优惠：把购物车按「目标总价（分）」等比例摊到各行成交单价上，
 * 使各行 price×quantity 之和尽量等于 targetCents。
 *  - 仅用于优惠：targetCents ≥ 原总价 或购物车为空时原样返回。
 *  - 取整余数优先落到某个「数量=1」的行（服装多为单件，可分毫不差地命中目标）；
 *    若没有单件行，则按数量整除落到第一行（可能有几分误差，实际成交以摊后合计为准）。
 *
 * @deprecated 新方案用订单级优惠字段 `orderDiscountCents`（createSale 入参），
 *   各行 price 保持原价、优惠单独记录，彻底避免多件行整数分摊无精确解的数学死角。
 *   此函数仅保留用于 UI 显示各行参考分摊价，不再用于实际开单入库。
 */
export function distributeOrderTotal(lines: CartLine[], targetCents: number): CartLine[] {
  const orig = cartTotalCents(lines);
  const target = Math.max(0, Math.round(targetCents));
  if (orig <= 0 || target >= orig) return lines.map((l) => ({ ...l }));
  const ratio = target / orig;
  const scaled = lines.map((l) => ({
    ...l,
    price: Math.max(0, Math.round(l.price * ratio)),
  }));
  const diff = target - cartTotalCents(scaled);
  if (diff !== 0) {
    const idx1 = scaled.findIndex((l) => l.quantity === 1);
    if (idx1 >= 0) {
      const t = scaled[idx1]!;
      scaled[idx1] = { ...t, price: Math.max(0, t.price + diff) };
    } else {
      const t = scaled[0]!;
      const per = Math.round(diff / t.quantity);
      scaled[0] = { ...t, price: Math.max(0, t.price + per) };
    }
  }
  return scaled;
}

/** 购物车件数合计 */
export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/**
 * 转换为下单入参（带幂等 opId）。
 * @param orderDiscountCents 整单优惠金额（分，可选）。各行按 lines 中的原价入库，
 *   优惠由服务端从 totalAmount 中扣减；不传则 orderDiscountCents=0（无整单优惠）。
 */
export function cartToSaleInput(
  lines: CartLine[],
  opId: string,
  orderDiscountCents?: number,
): CreateSaleOrderInput {
  return {
    opId,
    items: lines.map((l) => ({
      skuId: l.skuId,
      quantity: l.quantity,
      price: l.price,
    })),
    ...(orderDiscountCents ? { orderDiscountCents } : {}),
  };
}
