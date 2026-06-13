import type { ProductWithSkus } from "@cloth-scan/shared";
import type { CtLabel, CtPrintJob } from "../../modules/ct-printer/src/CtPrinter.types";

export interface LabelSizeMm {
  widthMm: number;
  heightMm: number;
}

export const DEFAULT_LABEL_SIZE: LabelSizeMm = { widthMm: 40, heightMm: 60 };

/** TSPL 价格用全角￥，多数热敏机的中文字库都含该字形，避免缺字 */
function yuanLabel(cents: number): string {
  return `￥${(cents / 100).toFixed(2)}`;
}

/**
 * 估算 drawText 文本宽度（mm）。CTPL 默认点阵字体：ASCII≈12 点/字、中文≈24 点/字（scale=1），
 * scale 为整数放大倍数。用于把文本水平居中。
 */
function textWidthMm(text: string, scale: number, dpi: number): number {
  const dotsPerMm = dpi / 25.4;
  let dots = 0;
  for (const ch of text) {
    const isWide = ch.charCodeAt(0) > 255; // 中文/全角
    dots += (isWide ? 24 : 12) * scale;
  }
  return dots / dotsPerMm;
}

/** 估算二维码模块数（ECC_M，AUTO 版本）——按条码长度粗估，用于居中 */
function estimateQrModules(dataLen: number): number {
  if (dataLen <= 14) return 21; // v1
  if (dataLen <= 26) return 25; // v2
  if (dataLen <= 42) return 29; // v3
  return 33; // v4
}

/**
 * 把商品 + 各 SKU 打印份数，排版成一次蓝牙打印任务。
 *
 * 新版布局（纵向 40×60 为基准，二维码为主、简洁美观）：
 *   ┌─────────┐
 *   │ ███ 大二维码 ███ │  ← 顶部居中，尽量大
 *   │  SKU 条码文本   │  ← 供人工输入兜底（限定在宽度内不溢出）
 *   │    ￥价格        │  ← 字号偏小
 *   └─────────┘
 *
 * 关键约束：
 *  - 二维码宽度自动限制在标签宽度内（按条码长度估算模块数，必要时缩小 qrCell）。
 *  - SKU 条码文本用 scale=1，估算宽度不超过标签宽度（吊牌条码约 17 字符 ≈ 25mm < 40mm）。
 * 注：二维码实际尺寸随条码长度变化，本函数按估算值居中；首次实物试打后如有偏移，
 * 可微调 qrCell / qrXAdjustMm / 各行 Y 坐标常量。
 */
export function buildCtPrintJob(
  product: ProductWithSkus,
  qtyBySku: Record<string, number>,
  opts?: {
    size?: LabelSizeMm;
    dpi?: number;
    qrCell?: number;
    qrXAdjustMm?: number;
  },
): CtPrintJob {
  const size = opts?.size ?? DEFAULT_LABEL_SIZE;
  const dpi = opts?.dpi ?? 203;
  const dotsPerMm = dpi / 25.4;
  // 二维码水平微调（mm，正=右移）。估算的二维码尺寸会让其略偏左，默认右移一点居中
  const qrXAdjustMm = opts?.qrXAdjustMm ?? 1.5;

  // 用一个待打印的条码估算二维码尺寸（同款各 SKU 条码长度相近）
  const sample =
    product.skus.find((s) => (qtyBySku[s.id] ?? 0) > 0)?.barcode ??
    product.skus[0]?.barcode ??
    "";
  const modules = estimateQrModules(sample.length);

  // 期望更大的二维码（默认 cell=8），但必须保证整体宽度不超出标签（留 ~4mm 边距）
  const wantCell = opts?.qrCell ?? 8;
  const maxCell = Math.max(
    3,
    Math.floor(((size.widthMm - 4) * dotsPerMm) / modules),
  );
  const qrCell = Math.min(wantCell, maxCell);
  const qrSizeMm = (modules * qrCell) / dotsPerMm;

  const qrYMm = 4;
  const qrXMm = Math.max(1, (size.widthMm - qrSizeMm) / 2 + qrXAdjustMm);
  const codeYMm = qrYMm + qrSizeMm + 2; // 二维码下方
  const priceYMm = codeYMm + 4; // 价格行（字号偏小）

  const centerX = (w: number) => Math.max(1, (size.widthMm - w) / 2);

  const labels: CtLabel[] = [];
  for (const sku of product.skus) {
    const copies = qtyBySku[sku.id] ?? 0;
    if (copies <= 0) continue;
    const code = sku.barcode;
    const price = yuanLabel(sku.salePrice);
    labels.push({
      qr: sku.barcode,
      copies,
      texts: [
        // SKU 条码：scale=1（最小可读字号），保证不超出标签宽度
        { xMm: centerX(textWidthMm(code, 1, dpi)), yMm: codeYMm, scale: 1, text: code },
        // 价格：字号调小（scale=1）
        { xMm: centerX(textWidthMm(price, 1, dpi)), yMm: priceYMm, scale: 1, text: price },
      ],
    });
  }

  return {
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    dpi,
    qrXMm,
    qrYMm,
    qrCell,
    labels,
  };
}

/** 该任务总标签张数 */
export function totalLabelCount(job: CtPrintJob): number {
  return job.labels.reduce((s, l) => s + l.copies, 0);
}
