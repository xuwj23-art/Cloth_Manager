import { describe, it, expect } from "vitest";
import {
  addToCart,
  addToCartQty,
  cartItemCount,
  cartToSaleInput,
  cartTotalCents,
  distributeOrderTotal,
  removeFromCart,
  setLinePrice,
  setQuantity,
  type CartLine,
  type ScannedSku,
} from "./cart";

const skuA: ScannedSku = {
  skuId: "a",
  barcode: "BC-A",
  productName: "T恤",
  color: "红",
  size: "M",
  price: 4900,
  stock: 3,
};

describe("cart 纯函数", () => {
  it("加入购物车新增一行", () => {
    const c = addToCart([], skuA);
    expect(c).toHaveLength(1);
    expect(c[0]!.quantity).toBe(1);
  });

  it("重复加入同一 SKU 数量累加但不超库存", () => {
    let c = addToCart([], skuA);
    c = addToCart(c, skuA);
    c = addToCart(c, skuA);
    c = addToCart(c, skuA); // 第4次，库存=3，应封顶3
    expect(c[0]!.quantity).toBe(3);
  });

  it("库存为 0 不加入", () => {
    const c = addToCart([], { ...skuA, stock: 0 });
    expect(c).toHaveLength(0);
  });

  it("addToCartQty 按数量新增且封顶库存", () => {
    const c = addToCartQty([], skuA, 2);
    expect(c[0]!.quantity).toBe(2);
    const capped = addToCartQty([], skuA, 99); // 库存=3
    expect(capped[0]!.quantity).toBe(3);
  });

  it("addToCartQty 在已有行上累加且不超库存", () => {
    let c = addToCartQty([], skuA, 1); // 1
    c = addToCartQty(c, skuA, 5); // 1+5=6 -> 封顶 3
    expect(c[0]!.quantity).toBe(3);
  });

  it("addToCartQty 非法数量按 1 处理", () => {
    const c = addToCartQty([], skuA, 0);
    expect(c[0]!.quantity).toBe(1);
  });

  it("setQuantity 夹取并可移除", () => {
    let c = addToCart([], skuA);
    c = setQuantity(c, "a", 2);
    expect(c[0]!.quantity).toBe(2);
    c = setQuantity(c, "a", 0);
    expect(c).toHaveLength(0);
  });

  it("合计金额与件数", () => {
    const lines: CartLine[] = [
      { ...skuA, quantity: 2 } as unknown as CartLine,
    ];
    // 构造完整 CartLine
    const cart: CartLine[] = [
      {
        skuId: "a",
        barcode: "BC-A",
        productName: "T恤",
        color: "红",
        size: "M",
        price: 4900,
        quantity: 2,
        stock: 3,
      },
    ];
    expect(cartTotalCents(cart)).toBe(9800);
    expect(cartItemCount(cart)).toBe(2);
    void lines;
  });

  it("removeFromCart 移除指定 SKU", () => {
    let c = addToCart([], skuA);
    c = removeFromCart(c, "a");
    expect(c).toHaveLength(0);
  });

  it("setLinePrice 改成交价并反映到合计；负数取 0", () => {
    let c = addToCartQty([], skuA, 2); // 2 件 @4900
    c = setLinePrice(c, "a", 4000); // 议价到 40 元
    expect(c[0]!.price).toBe(4000);
    expect(cartTotalCents(c)).toBe(8000);
    c = setLinePrice(c, "a", -100);
    expect(c[0]!.price).toBe(0);
  });

  it("distributeOrderTotal 单件行可精确命中目标总价（8.8折）", () => {
    const cart: CartLine[] = [
      { skuId: "a", barcode: "A", productName: "裙", color: "红", size: "M", price: 5900, quantity: 1, stock: 5 },
      { skuId: "b", barcode: "B", productName: "衫", color: "白", size: "L", price: 4100, quantity: 1, stock: 5 },
    ];
    const orig = cartTotalCents(cart); // 10000
    const target = Math.round(orig * 0.88); // 8800
    const out = distributeOrderTotal(cart, target);
    expect(cartTotalCents(out)).toBe(8800);
  });

  it("distributeOrderTotal 直接改价命中目标总价", () => {
    const cart: CartLine[] = [
      { skuId: "a", barcode: "A", productName: "裙", color: "红", size: "M", price: 5900, quantity: 1, stock: 5 },
      { skuId: "b", barcode: "B", productName: "衫", color: "白", size: "L", price: 4100, quantity: 1, stock: 5 },
    ];
    const out = distributeOrderTotal(cart, 8888);
    expect(cartTotalCents(out)).toBe(8888);
  });

  it("distributeOrderTotal 目标≥原价时原样返回", () => {
    const cart: CartLine[] = [
      { skuId: "a", barcode: "A", productName: "裙", color: "红", size: "M", price: 5900, quantity: 2, stock: 5 },
    ];
    const out = distributeOrderTotal(cart, 999999);
    expect(out[0]!.price).toBe(5900);
  });

  it("cartToSaleInput 生成带 opId 的下单入参", () => {
    const c = addToCart([], skuA);
    const input = cartToSaleInput(c, "op-123");
    expect(input.opId).toBe("op-123");
    expect(input.items[0]).toMatchObject({ skuId: "a", quantity: 1, price: 4900 });
  });
});
