import type { ProductWithSkus } from "@cloth-scan/shared";
import type { CtLabel, CtPrintJob } from "../../modules/ct-printer/src/CtPrinter.types";

export interface LabelSizeMm {
  widthMm: number;
  heightMm: number;
}

export const DEFAULT_LABEL_SIZE: LabelSizeMm = { widthMm: 60, heightMm: 40 };

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
 * 新版布局（横向 60×40 为基准，简洁美观）：
 *   ┌───────────────┐
 *   │   ███ 大二维码 ███   │  ← 居中，占主要视觉
 *   │     SKU 条码文本      │  ← 供人工输入兜底
 *   │      ￥价格           │  ← 加大字号
 *   └───────────────┘
 *
 * 注：二维码实际尺寸随条码长度变化，本函数按估算值居中；
 * 首次实物试打后如有偏移，可微调 qrCell / 各行 Y 坐标常量。
 */
export function buildCtPrintJob(
  product: ProductWithSkus,
  qtyBySku: Record<string, number>,
  opts?: { size?: LabelSizeMm; dpi?: number; qrCell?: number },
): CtPrintJob {
  const size = opts?.size ?? DEFAULT_LABEL_SIZE;
  const dpi = opts?.dpi ?? 203;
  const dotsPerMm = dpi / 25.4;
  const qrCell = opts?.qrCell ?? 6; // 单元格点数，越大二维码越大

  // 用一个待打印的条码估算二维码尺寸（同款各 SKU 条码长度相近）
  const sample =
    product.skus.find((s) => (qtyBySku[s.id] ?? 0) > 0)?.barcode ??
    product.skus[0]?.barcode ??
    "";
  const qrSizeMm = (estimateQrModules(sample.length) * qrCell) / dotsPerMm;

  const qrYMm = 3;
  const qrXMm = Math.max(1, (size.widthMm - qrSizeMm) / 2);
  const codeYMm = qrYMm + qrSizeMm + 1.5; // 二维码下方
  const priceYMm = codeYMm + 4.5; // 最下方价格

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
        { xMm: centerX(textWidthMm(code, 1, dpi)), yMm: codeYMm, scale: 1, text: code },
        { xMm: centerX(textWidthMm(price, 2, dpi)), yMm: priceYMm, scale: 2, text: price },
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
