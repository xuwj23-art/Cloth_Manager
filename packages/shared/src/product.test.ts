import { describe, expect, it } from "vitest";
import {
  expandSkuMatrix,
  CreateProductInput,
  UpdateProductInput,
  shouldArchive,
  ProductSchema,
  Money,
  MAX_QTY,
} from "./product";
import { SaleItemInput } from "./sale";

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
