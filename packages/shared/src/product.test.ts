import { describe, expect, it } from "vitest";
import {
  expandSkuMatrix,
  CreateProductInput,
  UpdateProductInput,
  shouldArchive,
  ProductSchema,
  Money,
  SignedMoney,
  MAX_QTY,
  memberPriceToTagPrice,
} from "./product";
import { SaleItemInput, CreateSaleOrderInput } from "./sale";

describe("Money / 数量上限（防 Int32 溢出与误输）", () => {
  it("Money 拒绝浮点/负数/超大金额", () => {
    expect(Money.safeParse(10.5).success).toBe(false);
    expect(Money.safeParse(-1).success).toBe(false);
    expect(Money.safeParse(1_000_000_001).success).toBe(false);
    expect(Money.safeParse(1_000_000_000).success).toBe(true);
  });

  it("SaleItemInput 拒绝超过上限的数量", () => {
    const base = { skuId: "00000000-0000-0000-0000-000000000000", price: 1000 };
    expect(SaleItemInput.safeParse({ ...base, quantity: MAX_QTY }).success).toBe(true);
    expect(SaleItemInput.safeParse({ ...base, quantity: MAX_QTY + 1 }).success).toBe(false);
  });
});

describe("SignedMoney / 整单加价（负优惠）", () => {
  it("SignedMoney 允许负数（=整单加价），拒绝浮点与越界", () => {
    expect(SignedMoney.safeParse(-500).success).toBe(true);
    expect(SignedMoney.safeParse(0).success).toBe(true);
    expect(SignedMoney.safeParse(10.5).success).toBe(false);
    expect(SignedMoney.safeParse(-1_000_000_001).success).toBe(false);
    expect(SignedMoney.safeParse(1_000_000_001).success).toBe(false);
  });

  it("CreateSaleOrderInput 接受负 orderDiscountCents", () => {
    const parsed = CreateSaleOrderInput.safeParse({
      opId: "op-1",
      items: [{ skuId: "00000000-0000-0000-0000-000000000000", quantity: 1, price: 9900 }],
      orderDiscountCents: -2000,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("memberPriceToTagPrice（会员价 → 原价，四舍五入到元）", () => {
  it("除不尽时四舍五入到元：99 元 → 141 元", () => {
    expect(memberPriceToTagPrice(9900)).toBe(14100);
  });

  it("精确整除：70 元 → 100 元", () => {
    expect(memberPriceToTagPrice(7000)).toBe(10000);
  });

  it("五入进位：70.5 元 → 100.71 元 → 101 元", () => {
    expect(memberPriceToTagPrice(7050)).toBe(10100);
  });

  it("0 → 0", () => {
    expect(memberPriceToTagPrice(0)).toBe(0);
  });

  it("结果恒为整元（100 分的整数倍）", () => {
    for (const cents of [1, 17, 123, 999, 12345, 999900]) {
      expect(memberPriceToTagPrice(cents) % 100).toBe(0);
    }
  });
});

describe("expandSkuMatrix", () => {
  it("展开颜色 × 尺码 的笛卡尔积", () => {
    const skus = expandSkuMatrix({
      colors: ["红", "蓝"],
      sizes: ["S", "M", "L"],
      costPrice: 1000,
      salePrice: 2999,
    });
    expect(skus).toHaveLength(6);
    expect(skus[0]).toMatchObject({ color: "红", size: "S", initialStock: 0 });
  });

  it("按尺码指定初始库存（单颜色 × 多尺码建档模型）", () => {
    const skus = expandSkuMatrix({
      colors: ["白"],
      sizes: ["S", "M", "L"],
      costPrice: 2000,
      salePrice: 5800,
      initialStockBySize: { S: 2, M: 5 }, // L 未指定回落 initialStock（默认 0）
    });
    expect(skus).toHaveLength(3);
    expect(skus[0]).toMatchObject({ color: "白", size: "S", initialStock: 2 });
    expect(skus[1]).toMatchObject({ color: "白", size: "M", initialStock: 5 });
    expect(skus[2]).toMatchObject({ color: "白", size: "L", initialStock: 0 });
  });

  it("生成的 SKU 能通过 CreateProductInput 校验", () => {
    const skus = expandSkuMatrix({
      colors: ["黑"],
      sizes: ["M"],
      costPrice: 5000,
      salePrice: 9900,
      initialStock: 3,
    });
    const parsed = CreateProductInput.safeParse({ name: "测试款", skus });
    expect(parsed.success).toBe(true);
  });

  it("CreateProductInput 可带 images / material / categoryName", () => {
    const skus = expandSkuMatrix({
      colors: ["酒红"],
      sizes: ["均码"],
      costPrice: 1000,
      salePrice: 5900,
      initialStock: 1,
    });
    const parsed = CreateProductInput.safeParse({
      name: "酒红连衣裙",
      images: ["/uploads/a.jpg", "/uploads/b.jpg", "/uploads/c.jpg"],
      material: "默认",
      categoryName: "连衣裙",
      skus,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("UpdateProductInput", () => {
  it("可带 images / material / categoryName", () => {
    const parsed = UpdateProductInput.safeParse({
      name: "酒红连衣裙",
      images: ["/uploads/a.jpg", "/uploads/b.jpg", "/uploads/c.jpg"],
      material: "真丝",
      categoryName: "连衣裙",
    });
    expect(parsed.success).toBe(true);
  });

  it("SKU 可改颜色和尺码", () => {
    const parsed = UpdateProductInput.safeParse({
      skus: [
        {
          id: "00000000-0000-0000-0000-000000000000",
          color: "酒红",
          size: "M",
          salePrice: 5900,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("支持新增尺码（addSkus）与删除尺码（removeSkuIds）", () => {
    const parsed = UpdateProductInput.safeParse({
      addSkus: [{ color: "酒红", size: "XL", costPrice: 4500, salePrice: 9900, initialStock: 2 }],
      removeSkuIds: ["00000000-0000-0000-0000-000000000000"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.addSkus?.[0]).toMatchObject({ size: "XL", initialStock: 2 });
      expect(parsed.data.removeSkuIds).toHaveLength(1);
    }
  });

  it("removeSkuIds 拒绝非 uuid", () => {
    const parsed = UpdateProductInput.safeParse({ removeSkuIds: ["not-a-uuid"] });
    expect(parsed.success).toBe(false);
  });
});

describe("ProductSchema", () => {
  it("包含 deletedAt 软删除字段（与 Prisma 对齐）", () => {
    const parsed = ProductSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000000",
      shopId: "00000000-0000-0000-0000-000000000000",
      name: "测试款",
      categoryId: null,
      coverImage: null,
      images: [],
      archivedAt: null,
      deletedAt: null,
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.deletedAt).toBeNull();
    }
  });

  it("deletedAt 可为 ISO 时间戳字符串", () => {
    const parsed = ProductSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000000",
      shopId: "00000000-0000-0000-0000-000000000000",
      name: "测试款",
      categoryId: null,
      coverImage: null,
      images: [],
      archivedAt: null,
      deletedAt: "2026-08-04T00:00:00.000Z",
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("shouldArchive", () => {
  const existingIso = "2026-01-01T00:00:00.000Z";

  it("售罄归档：总库存 0 且未归档 → 返回 ISO 字符串", () => {
    const r = shouldArchive({ totalStock: 0, archivedAt: null, deletedAt: null });
    expect(r).not.toBeNull();
    expect(typeof r).toBe("string");
    // 校验是合法 ISO datetime
    expect(() => new Date(r!).toISOString()).not.toThrow();
  });

  it("补货恢复：总库存 > 0 且已归档 → 返回 null", () => {
    const r = shouldArchive({
      totalStock: 5,
      archivedAt: existingIso,
      deletedAt: null,
    });
    expect(r).toBeNull();
  });

  it("已删不复活：已删除且未归档 → 返回 null（不会因补货或售罄改变状态）", () => {
    const r = shouldArchive({
      totalStock: 0,
      archivedAt: null,
      deletedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(r).toBeNull();
  });

  it("已删保持归档：已删除且已归档 → 返回当前 archivedAt（不恢复在售）", () => {
    const r = shouldArchive({
      totalStock: 5,
      archivedAt: existingIso,
      deletedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(r).toBe(existingIso);
  });

  it("保持现状：总库存 > 0 且未归档 → 返回 null", () => {
    const r = shouldArchive({ totalStock: 5, archivedAt: null, deletedAt: null });
    expect(r).toBeNull();
  });

  it("保持现状归档：总库存 0 且已归档 → 返回当前 archivedAt", () => {
    const r = shouldArchive({
      totalStock: 0,
      archivedAt: existingIso,
      deletedAt: null,
    });
    expect(r).toBe(existingIso);
  });
});
