import { describe, expect, it } from "vitest";
import { expandSkuMatrix, CreateProductInput } from "./product.js";

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
});
