/**
 * 建档芯片预设与识图映射（前后端共用）。
 * 颜色对不上芯片时写自定义短词，禁止回落到「默认」。
 */

export const PRESET_COLORS = ["黑", "白", "灰", "红", "蓝", "绿", "黄", "粉", "卡其"] as const;
/** 印花/多色。手动未选色才用「默认」，识图禁止用默认顶替。 */
export const SYSTEM_COLORS = ["花色"] as const;

/** 尺码预设分组（建档页按组分区展示，组内多选） */
export const PRESET_SIZE_GROUPS: ReadonlyArray<{ label: string; sizes: string[] }> = [
  { label: "字母码", sizes: ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"] },
  { label: "女装码", sizes: ["00", "0", "2", "4", "6", "8", "12", "14", "16", "18"] },
  { label: "裤装码", sizes: ["32", "34", "36", "38", "40", "42", "44", "46"] },
];

/** 扁平整单尺码预设（编辑页单选芯片等场景）：三组按序拼接 + 均码 */
export const PRESET_SIZES = [...PRESET_SIZE_GROUPS.flatMap((g) => g.sizes), "均码"] as const;

/**
 * 材质（单选）。「默认」置顶；其余顺序与历史建档页一致（热门在前）。
 */
export const PRESET_MATERIALS = [
  "默认",
  "纯棉",
  "雪纺",
  "牛仔",
  "针织",
  "真丝",
  "羊毛",
  "蕾丝",
  "莫代尔",
  "棉麻",
  "羊绒",
  "亚麻",
  "苎麻",
  "涤纶",
  "锦纶",
  "氨纶",
  "天丝",
  "粘纤",
  "桑蚕丝",
  "羊羔毛",
  "马海毛",
  "灯芯绒",
  "皮革",
  "麂皮绒",
  "毛呢",
  "法兰绒",
  "珊瑚绒",
  "天鹅绒",
  "丝绒",
  "网纱",
  "醋酸",
  "冰丝",
  "太空棉",
  "罗纹",
  "混纺",
  "化纤",
  "羽绒",
  "皮草",
] as const;

/**
 * 服装品类（单选）。女装热门排在最前。
 */
export const PRESET_CATEGORIES = [
  "连衣裙",
  "T恤",
  "衬衫",
  "卫衣",
  "半身裙",
  "阔腿裤",
  "牛仔裤",
  "针织衫",
  "毛衣",
  "外套",
  "短袖",
  "长袖",
  "Polo衫",
  "打底衫",
  "吊带",
  "背心",
  "马甲",
  "休闲裤",
  "西裤",
  "工装裤",
  "直筒裤",
  "小脚裤",
  "哈伦裤",
  "打底裤",
  "运动裤",
  "卫裤",
  "短裤",
  "五分裤",
  "七分裤",
  "九分裤",
  "背带裤",
  "风衣",
  "大衣",
  "西装",
  "棉服",
  "棉袄",
  "羽绒服",
  "皮衣",
  "套装",
  "连体裤",
  "睡衣套装",
  "内衣",
  "内裤",
  "保暖内衣",
  "围巾",
  "丝巾",
  "袜子",
] as const;

/** 默认展示的热门数量（约两行） */
export const HOT_MATERIAL_COUNT = 10;
export const HOT_CATEGORY_COUNT = 10;

export const TITLE_MIN = 5;
export const TITLE_MAX = 60;
export const CUSTOM_COLOR_MAX = 6;
export const CUSTOM_CATEGORY_MAX = 10;

export type GarmentVisionRaw = { name: string; category: string; color: string };
export type GarmentVisionMapped = {
  name: string;
  category: string;
  color: string;
  colorIsPreset: boolean;
  categoryIsPreset: boolean;
};

const PRESET_COLOR_SET = new Set<string>(PRESET_COLORS);
const PRESET_CATEGORY_SET = new Set<string>(PRESET_CATEGORIES);

const COLOR_SYNONYMS: Record<
  string,
  (typeof PRESET_COLORS)[number] | (typeof SYSTEM_COLORS)[number]
> = {
  黑色: "黑",
  纯黑: "黑",
  玄黑: "黑",
  白色: "白",
  米白: "白",
  乳白: "白",
  纯白: "白",
  米黄色: "白",
  灰色: "灰",
  深灰: "灰",
  浅灰: "灰",
  花灰: "灰",
  红色: "红",
  大红: "红",
  正红: "红",
  朱红: "红",
  蓝色: "蓝",
  深蓝: "蓝",
  浅蓝: "蓝",
  藏青: "蓝",
  藏蓝: "蓝",
  天蓝: "蓝",
  绿色: "绿",
  深绿: "绿",
  浅绿: "绿",
  黄色: "黄",
  明黄: "黄",
  粉色: "粉",
  粉红色: "粉",
  桃粉: "粉",
  卡其: "卡其",
  卡其色: "卡其",
  khaki: "卡其",
};

const FLORAL_KEYWORDS = ["印花", "碎花", "撞色", "多色", "花色", "拼色"];

const CATEGORY_SYNONYMS: Record<string, (typeof PRESET_CATEGORIES)[number]> = {
  裙子: "连衣裙",
  裙: "连衣裙",
  连身裙: "连衣裙",
  t恤: "T恤",
  tee: "T恤",
  tshirt: "T恤",
  "t-shirt": "T恤",
  短袖t: "T恤",
  短袖T: "T恤",
  t恤衫: "T恤",
  衬衣: "衬衫",
  卫衣衫: "卫衣",
  牛子裤: "牛仔裤",
};

function compactText(raw: string): string {
  return raw.replace(/\s+/g, "").trim();
}

function clipChars(raw: string, max: number): string {
  return compactText(raw).slice(0, max);
}

/**
 * 命中 9 色或花色 → isPreset true；否则 value=短自定义且禁止「默认」。
 * 空 raw → { value: "未识别色", isPreset: false }。
 */
export function matchPresetColor(raw: string): { value: string; isPreset: boolean } {
  const t = compactText(raw);
  if (!t) return { value: "未识别色", isPreset: false };

  if (FLORAL_KEYWORDS.some((k) => t.includes(k))) {
    return { value: "花色", isPreset: true };
  }

  if (PRESET_COLOR_SET.has(t)) return { value: t, isPreset: true };

  const synonym = COLOR_SYNONYMS[t] ?? COLOR_SYNONYMS[t.toLowerCase()];
  if (synonym) {
    return { value: synonym, isPreset: synonym === "花色" ? true : PRESET_COLOR_SET.has(synonym) };
  }

  if (t === "默认") return { value: "未识别色", isPreset: false };

  return { value: clipChars(t, CUSTOM_COLOR_MAX) || "未识别色", isPreset: false };
}

/** 同义词命中则返回预设，否则 null（调用方改用自定义短词）。 */
export function matchPresetCategory(raw: string): string | null {
  const t = compactText(raw);
  if (!t) return null;
  if (PRESET_CATEGORY_SET.has(t)) return t;
  const hit = CATEGORY_SYNONYMS[t] ?? CATEGORY_SYNONYMS[t.toLowerCase()];
  return hit ?? null;
}

/**
 * 标题：去空白；不足 5 字则用颜色（默认则省略）+ 品类；仍不足则后缀补「女装」到至少 5 字；超过 60 截断。
 */
export function normalizeProductTitle(
  name: string,
  fallbackColor: string,
  fallbackCategory: string,
): string {
  let t = compactText(name);
  if (t.length < TITLE_MIN) {
    const colorPart = fallbackColor && fallbackColor !== "默认" ? fallbackColor : "";
    const composed = compactText(`${colorPart}${fallbackCategory}`);
    if (composed.length > t.length) t = composed;
  }
  if (t.length < TITLE_MIN) {
    while (t.length < TITLE_MIN) t += "女装";
  }
  if (t.length > TITLE_MAX) t = t.slice(0, TITLE_MAX);
  return t;
}

export function mapGarmentVision(raw: GarmentVisionRaw): GarmentVisionMapped {
  const colorHit = matchPresetColor(raw.color ?? "");
  const catHit = matchPresetCategory(raw.category ?? "");
  const customCat = clipChars(raw.category ?? "", CUSTOM_CATEGORY_MAX);
  const category = catHit ?? (customCat || "未识别类");
  const name = normalizeProductTitle(raw.name ?? "", colorHit.value, category);
  return {
    name,
    category,
    color: colorHit.value,
    colorIsPreset: colorHit.isPreset,
    categoryIsPreset: catHit !== null,
  };
}
