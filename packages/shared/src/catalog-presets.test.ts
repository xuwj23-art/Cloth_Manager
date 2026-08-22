import { describe, expect, it } from "vitest";
import {
  mapGarmentVision,
  matchPresetCategory,
  matchPresetColor,
  normalizeProductTitle,
  PRESET_CATEGORIES,
  PRESET_MATERIALS,
} from "./catalog-presets";

describe("matchPresetColor", () => {
  it("命中预设与同义词", () => {
    expect(matchPresetColor("黑")).toEqual({ value: "黑", isPreset: true });
    expect(matchPresetColor("红色")).toEqual({ value: "红", isPreset: true });
    expect(matchPresetColor("大红")).toEqual({ value: "红", isPreset: true });
    expect(matchPresetColor("藏青")).toEqual({ value: "蓝", isPreset: true });
    expect(matchPresetColor("米白")).toEqual({ value: "白", isPreset: true });
    expect(matchPresetColor("khaki")).toEqual({ value: "卡其", isPreset: true });
    expect(matchPresetColor("卡其")).toEqual({ value: "卡其", isPreset: true });
  });

  it("印花/多色 → 花色", () => {
    expect(matchPresetColor("碎花")).toEqual({ value: "花色", isPreset: true });
    expect(matchPresetColor("印花裙")).toEqual({ value: "花色", isPreset: true });
    expect(matchPresetColor("多色")).toEqual({ value: "花色", isPreset: true });
    expect(matchPresetColor("撞色")).toEqual({ value: "花色", isPreset: true });
  });

  it("酒红保持自定义且不是默认", () => {
    expect(matchPresetColor("酒红")).toEqual({ value: "酒红", isPreset: false });
    expect(matchPresetColor("墨绿")).toEqual({ value: "墨绿", isPreset: false });
    expect(matchPresetColor("驼色")).toEqual({ value: "驼色", isPreset: false });
  });

  it("空 raw 与模型写默认都变成未识别色", () => {
    expect(matchPresetColor("")).toEqual({ value: "未识别色", isPreset: false });
    expect(matchPresetColor("   ")).toEqual({ value: "未识别色", isPreset: false });
    expect(matchPresetColor("默认")).toEqual({ value: "未识别色", isPreset: false });
  });

  it("超长颜色截成 6 字，不整句当颜色", () => {
    expect(matchPresetColor("浅卡其偏黄的那种")).toEqual({
      value: "浅卡其偏黄的",
      isPreset: false,
    });
  });
});

describe("matchPresetCategory", () => {
  it("命中预设与同义词", () => {
    expect(matchPresetCategory("连衣裙")).toBe("连衣裙");
    expect(matchPresetCategory("裙子")).toBe("连衣裙");
    expect(matchPresetCategory("tee")).toBe("T恤");
    expect(matchPresetCategory("T恤")).toBe("T恤");
    expect(matchPresetCategory("短袖T")).toBe("T恤");
    expect(matchPresetCategory("衬衣")).toBe("衬衫");
    expect(matchPresetCategory("卫衣衫")).toBe("卫衣");
    expect(matchPresetCategory("牛子裤")).toBe("牛仔裤");
  });

  it("未命中返回 null", () => {
    expect(matchPresetCategory("")).toBeNull();
    expect(matchPresetCategory("工装马甲套")).toBeNull();
  });
});

describe("normalizeProductTitle", () => {
  it("短标题用颜色+品类补齐", () => {
    expect(normalizeProductTitle("红裙", "酒红", "连衣裙")).toBe("酒红连衣裙");
    expect(normalizeProductTitle("", "酒红", "连衣裙")).toBe("酒红连衣裙");
  });

  it("颜色为默认时省略颜色", () => {
    expect(normalizeProductTitle("", "默认", "连衣裙")).toBe("连衣裙女装");
  });

  it("仍不足 5 字则补女装到至少 5 字", () => {
    expect(normalizeProductTitle("", "默认", "")).toBe("女装女装女装");
    expect(normalizeProductTitle("T恤", "默认", "")).toBe("T恤女装女装");
    expect(normalizeProductTitle("T恤", "默认", "").length).toBeGreaterThanOrEqual(5);
  });

  it("超长截断到 60", () => {
    const long = "春".repeat(80);
    expect(normalizeProductTitle(long, "红", "连衣裙")).toHaveLength(60);
  });

  it("已满 5 字保持原名", () => {
    expect(normalizeProductTitle("纯棉圆领T恤", "白", "T恤")).toBe("纯棉圆领T恤");
  });
});

describe("mapGarmentVision", () => {
  it("同义词映射：裙子→连衣裙、大红→红", () => {
    const m = mapGarmentVision({ name: "红色连衣裙", category: "裙子", color: "大红" });
    expect(m.category).toBe("连衣裙");
    expect(m.categoryIsPreset).toBe(true);
    expect(m.color).toBe("红");
    expect(m.colorIsPreset).toBe(true);
    expect(m.name.length).toBeGreaterThanOrEqual(5);
  });

  it("酒红保持自定义，不是默认", () => {
    const m = mapGarmentVision({ name: "", category: "连衣裙", color: "酒红" });
    expect(m.color).toBe("酒红");
    expect(m.colorIsPreset).toBe(false);
    expect(m.name).toBe("酒红连衣裙");
  });

  it("空颜色 → 未识别色", () => {
    const m = mapGarmentVision({ name: "某件衣服啊", category: "外套", color: "" });
    expect(m.color).toBe("未识别色");
    expect(m.colorIsPreset).toBe(false);
  });
});

describe("预设搬迁完整性", () => {
  it("材质以默认开头且含历史热门", () => {
    expect(PRESET_MATERIALS[0]).toBe("默认");
    expect(PRESET_MATERIALS).toContain("纯棉");
    expect(PRESET_MATERIALS).toContain("雪纺");
  });

  it("品类含连衣裙与 T恤", () => {
    expect(PRESET_CATEGORIES[0]).toBe("连衣裙");
    expect(PRESET_CATEGORIES).toContain("T恤");
  });
});
