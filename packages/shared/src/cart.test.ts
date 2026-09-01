import { describe, it, expect } from "vitest";
import {
  addToCart,
  addToCartQty,
  cartItemCount,
  cartToSaleInput,
  cartTotalCents,
  distributeOrderTotal,
  lineBasePrice,
  lineMemberPrice,
  rebaseMemberLines,
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

  it("addToCartQty 已有行保留议价单价（不被吊牌价重置）", () => {
    let c = addToCart([], skuA);
    c = setLinePrice(c, skuA.skuId, 4000); // 议价 40 元
    c = addToCart(c, skuA); // 再扫一件同款
    expect(c[0]!.quantity).toBe(2);
    expect(c[0]!.price).toBe(4000); // 仍是议价，未跳回 4900
    expect(cartTotalCents(c)).toBe(8000);
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
    const lines: CartLine[] = [{ ...skuA, quantity: 2 } as unknown as CartLine];
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
      {
        skuId: "a",
        barcode: "A",
        productName: "裙",
        color: "红",
        size: "M",
        price: 5900,
        quantity: 1,
        stock: 5,
      },
      {
        skuId: "b",
        barcode: "B",
        productName: "衫",
        color: "白",
        size: "L",
        price: 4100,
        quantity: 1,
        stock: 5,
      },
    ];
    const orig = cartTotalCents(cart); // 10000
    const target = Math.round(orig * 0.88); // 8800
    const out = distributeOrderTotal(cart, target);
    expect(cartTotalCents(out)).toBe(8800);
  });

  it("distributeOrderTotal 直接改价命中目标总价", () => {
    const cart: CartLine[] = [
      {
        skuId: "a",
        barcode: "A",
        productName: "裙",
        color: "红",
        size: "M",
        price: 5900,
        quantity: 1,
        stock: 5,
      },
      {
        skuId: "b",
        barcode: "B",
        productName: "衫",
        color: "白",
        size: "L",
        price: 4100,
        quantity: 1,
        stock: 5,
      },
    ];
    const out = distributeOrderTotal(cart, 8888);
    expect(cartTotalCents(out)).toBe(8888);
  });

  it("distributeOrderTotal 目标≥原价时原样返回", () => {
    const cart: CartLine[] = [
      {
        skuId: "a",
        barcode: "A",
        productName: "裙",
        color: "红",
        size: "M",
        price: 5900,
        quantity: 2,
        stock: 5,
      },
    ];
    const out = distributeOrderTotal(cart, 999999);
    expect(out[0]!.price).toBe(5900);
  });

  it("cartToSaleInput 生成带 opId 的下单入参", () => {
    const c = addToCart([], skuA);
    const input = cartToSaleInput(c, "op-123");
    expect(input.opId).toBe("op-123");
    expect(input.items[0]).toMatchObject({ skuId: "a", quantity: 1, price: 4900 });
    // 不传 orderDiscountCents 时不出现在输出（z.optional()）
    expect(input.orderDiscountCents).toBeUndefined();
  });

  it("cartToSaleInput 带 orderDiscountCents 写入输出且各行保持原价", () => {
    const cart: CartLine[] = [
      {
        skuId: "a",
        barcode: "A",
        productName: "裙",
        color: "红",
        size: "M",
        price: 5900,
        quantity: 3,
        stock: 5,
      },
      {
        skuId: "b",
        barcode: "B",
        productName: "衫",
        color: "白",
        size: "L",
        price: 4100,
        quantity: 3,
        stock: 5,
      },
    ];
    // 原价合计 = 5900*3 + 4100*3 = 30000；目标实收 25000（A3 数学死角场景：3a+3b=250 无整数解）
    const orig = cartTotalCents(cart);
    const targetTotal = 25000;
    const orderDiscountCents = orig - targetTotal; // 5000
    const input = cartToSaleInput(cart, "op-disc", orderDiscountCents);
    expect(input.opId).toBe("op-disc");
    expect(input.orderDiscountCents).toBe(5000);
    // 各行 price 保持原价，不再做整数分摊
    expect(input.items[0]).toMatchObject({ skuId: "a", quantity: 3, price: 5900 });
    expect(input.items[1]).toMatchObject({ skuId: "b", quantity: 3, price: 4100 });
    // orderDiscountCents=0 时省略（保持与无优惠一致的入参形态）
    const zeroInput = cartToSaleInput(cart, "op-zero", 0);
    expect(zeroInput.orderDiscountCents).toBeUndefined();
  });

  it("缩略图路径随行携带：新行带图、重扫可刷新图、无图保留旧图", () => {
    const sku: ScannedSku = { ...skuA, image: "/uploads/a.jpg" };
    const lines = addToCartQty([], sku, 1);
    expect(lines[0]!.image).toBe("/uploads/a.jpg");

    // 重扫同款且无图信息（旧缓存）：保留旧行的图
    const keep = addToCartQty(lines, { ...skuA }, 1);
    expect(keep[0]!.image).toBe("/uploads/a.jpg");

    // 重扫且服务端换了新图：更新
    const updated = addToCartQty(lines, { ...skuA, image: "/uploads/b.jpg" }, 1);
    expect(updated[0]!.image).toBe("/uploads/b.jpg");

    // 无图商品：image 为 null，UI 回退占位字
    const noImg = addToCartQty([], { ...skuA, image: null }, 1);
    expect(noImg[0]!.image).toBeNull();
  });
});

describe("会员价（memberPrice）", () => {
  // 会员价 70 元（salePrice=7000），原价 = 70/0.7 = 100 元
  const memberSku: ScannedSku = { ...skuA, price: 10000, memberPrice: 7000 };

  it("新行携带会员价快照；未提供时回退成交价", () => {
    const c = addToCart([], memberSku);
    expect(c[0]!.memberPrice).toBe(7000);
    const fallback = addToCart([], skuA); // 无 memberPrice
    expect(lineMemberPrice(fallback[0]!)).toBe(4900);
  });

  it("已有行重扫刷新会员价快照但保留议价单价", () => {
    let c = addToCart([], memberSku);
    c = setLinePrice(c, "a", 8000); // 议价 80 元
    c = addToCart(c, { ...memberSku, memberPrice: 6900 }); // 服务端改价后重扫
    expect(c[0]!.price).toBe(8000); // 议价保留
    expect(c[0]!.memberPrice).toBe(6900); // 快照刷新
  });

  it("lineBasePrice：会员态=会员价，非会员态=原价（÷0.7 取整到元）", () => {
    const c = addToCart([], memberSku);
    expect(lineBasePrice(c[0]!, true)).toBe(7000);
    expect(lineBasePrice(c[0]!, false)).toBe(10000);
  });

  it("rebaseMemberLines 切到会员：未改价行重置为会员价，改价行保留", () => {
    let c = addToCartQty([], memberSku, 1); // 非会员进车 100 元
    c = setLinePrice(c, "a", 9000); // 议价 90 元
    const out = rebaseMemberLines(c, true);
    expect(out[0]!.price).toBe(9000); // 手动改价保留
    expect(out[0]!.origPrice).toBe(7000); // 基准价对齐会员态
  });

  it("rebaseMemberLines 切回非会员：会员价进车的行重置为原价", () => {
    const memberEntry: ScannedSku = { ...skuA, price: 7000, memberPrice: 7000 };
    const c = addToCart([], memberEntry); // 会员态进车 70 元
    const out = rebaseMemberLines(c, false);
    expect(out[0]!.price).toBe(10000); // 重置为原价
    expect(out[0]!.origPrice).toBe(10000);
  });

  it("rebaseMemberLines 空购物车与无 memberPrice 行不炸", () => {
    expect(rebaseMemberLines([], true)).toEqual([]);
    const plain = addToCart([], skuA); // 无 memberPrice（回退 price）
    const out = rebaseMemberLines(plain, false);
    expect(out[0]!.price).toBe(Math.round(4900 / 0.7 / 100) * 100); // 70 元
  });
});
