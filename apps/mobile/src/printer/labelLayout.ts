import type { ProductWithSkus } from "@cloth-scan/shared";
import type { CtLabel, CtPrintJob } from "../../modules/ct-printer/src/CtPrinter.types";

export interface LabelSizeMm {
  widthMm: number;
  heightMm: number;
}

/** 物理标签尺寸基准：60×40（60mm 那条边为进纸/打印头方向） */
export const DEFAULT_LABEL_SIZE: LabelSizeMm = { widthMm: 60, heightMm: 40 };

/** 打印方向：landscape=内容正排；portrait=内容旋转 90°（横版纸印出纵向阅读的标签） */
export type LabelOrientation = "landscape" | "portrait";

/**
 * 估算 drawText 文本长度（mm，沿文字阅读方向）。CTPL 默认点阵字体：
 * ASCII≈12 点/字、中文/全角≈24 点/字（scale=1），scale 为整数放大倍数。
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
 * 物理标签固定为 60×40（60mm 进纸方向）。orientation 决定内容朝向：
 *  - landscape（正排）：二维码与 SKU 条码作为一组在标签内居中。
 *  - portrait（纵向）：内容旋转 90° 印在 60×40 横版纸上——二维码在打印画布一侧，
 *    SKU 文本旋转 90° 排在另一侧。打印出来后把标签转 90° 拿在手里，即是
 *    「二维码在上、SKU 在下」的纵向标签（40 宽 × 60 高）。
 *
 * 标签不含价格。二维码尺寸算法保持不变。
 */
export function buildCtPrintJob(
  product: ProductWithSkus,
  qtyBySku: Record<string, number>,
  opts?: {
    size?: LabelSizeMm;
    dpi?: number;
    qrCell?: number;
    qrXAdjustMm?: number;
    orientation?: LabelOrientation;
  },
): CtPrintJob {
  const size = opts?.size ?? DEFAULT_LABEL_SIZE;
  const dpi = opts?.dpi ?? 203;
  const dotsPerMm = dpi / 25.4;
  const orientation = opts?.orientation ?? "landscape";
  const W = size.widthMm;
  const H = size.heightMm;

  // 用一个待打印的条码估算二维码尺寸（同款各 SKU 条码长度相近）
  const sample =
    product.skus.find((s) => (qtyBySku[s.id] ?? 0) > 0)?.barcode ?? product.skus[0]?.barcode ?? "";
  const modules = estimateQrModules(sample.length);

  if (orientation === "portrait") {
    return buildPortrait(product, qtyBySku, {
      W,
      H,
      dpi,
      dotsPerMm,
      modules,
      wantCell: opts?.qrCell ?? 10,
    });
  }
  return buildLandscape(product, qtyBySku, {
    W,
    H,
    dpi,
    dotsPerMm,
    modules,
    wantCell: opts?.qrCell ?? 6,
    qrXAdjustMm: opts?.qrXAdjustMm ?? 2.5,
  });
}

interface BuildCtx {
  W: number;
  H: number;
  dpi: number;
  dotsPerMm: number;
  modules: number;
  wantCell: number;
}

/** scale=1 点阵字高约 24 点 */
function textHeightMm(scale: number, dpi: number): number {
  return (24 * scale) / (dpi / 25.4);
}

/** 正排（横版）：二维码 + SKU 作为一组在标签内水平、垂直居中 */
function buildLandscape(
  product: ProductWithSkus,
  qtyBySku: Record<string, number>,
  ctx: BuildCtx & { qrXAdjustMm: number },
): CtPrintJob {
  const { W, H, dpi, dotsPerMm, modules, wantCell, qrXAdjustMm } = ctx;
  // 二维码尺寸算法不变（仍按给两行文本留空的上限，避免二维码变大）
  const maxCell = Math.max(3, Math.floor((Math.min(W - 4, H - 11) * dotsPerMm) / modules));
  const qrCell = Math.min(wantCell, maxCell);
  const qrSizeMm = (modules * qrCell) / dotsPerMm;

  const gapQrSku = 1.5;
  const skuH = textHeightMm(1, dpi);
  const groupH = qrSizeMm + gapQrSku + skuH;
  const qrYMm = Math.max(1, (H - groupH) / 2);
  const qrXMm = Math.max(1, (W - qrSizeMm) / 2 + qrXAdjustMm);
  const codeYMm = qrYMm + qrSizeMm + gapQrSku;
  const centerX = (w: number) => Math.max(1, (W - w) / 2);

  const labels: CtLabel[] = [];
  for (const sku of product.skus) {
    const copies = qtyBySku[sku.id] ?? 0;
    if (copies <= 0) continue;
    const code = sku.barcode;
    labels.push({
      qr: sku.barcode,
      copies,
      texts: [{ xMm: centerX(textWidthMm(code, 1, dpi)), yMm: codeYMm, scale: 1, text: code }],
    });
  }
  return { widthMm: W, heightMm: H, dpi, qrXMm, qrYMm, qrCell, labels };
}

/** portrait 文本旋转角度；若实物上下颠倒/错位，在 90 / 270 间切换 */
const PORTRAIT_TEXT_ROTATE = 90;

/** portrait 二维码水平微调（mm，沿画布 Y/纵向标签左右方向；正=纵向标签里往右） */
const PORTRAIT_QR_Y_ADJUST_MM = 1;

/** portrait SKU 行水平微调（mm，沿画布 Y；正=纵向标签里往右） */
const PORTRAIT_SKU_Y_ADJUST_MM = 2;

/** portrait 整组（二维码+SKU）竖直微调（mm，沿画布 X；正=纵向标签里整体上移） */
const PORTRAIT_GROUP_X_ADJUST_MM = 4;

/**
 * 纵向（旋转 90°）：在 60×40 横版画布上把内容旋转 90° 排版。
 *
 * 坐标说明（已据实物照片校准）：
 *  - 画布 X 轴(0..W) 对应「拿在手里的纵向标签」的上下方向：X 越大越靠上。
 *    「二维码在上 / SKU 在下」⇒ 画布 X：sku < 二维码。
 *  - 画布 Y 轴(0..H) 对应纵向标签的左右方向；旋转文本沿 Y 方向延伸，
 *    用 (H - 文本长度)/2 在 H 内居中。
 *  - 整组（二维码 + SKU）在 X 方向整体居中。
 */
function buildPortrait(
  product: ProductWithSkus,
  qtyBySku: Record<string, number>,
  ctx: BuildCtx,
): CtPrintJob {
  const { W, H, dpi, dotsPerMm, modules, wantCell } = ctx;
  // 二维码尽量大：受限于画布高度 H（纵向标签的宽度），留约 4mm 边距；算法不变
  const maxCell = Math.max(3, Math.floor(((H - 4) * dotsPerMm) / modules));
  const qrCell = Math.min(wantCell, maxCell);
  const qrSizeMm = (modules * qrCell) / dotsPerMm;

  const gapQrSku = 4;
  const groupLen = qrSizeMm + gapQrSku;
  const maxSkuX = Math.max(2, W - 1 - gapQrSku - qrSizeMm);
  const skuXMm = Math.min(maxSkuX, Math.max(2, (W - groupLen) / 2 + PORTRAIT_GROUP_X_ADJUST_MM));
  const qrXMm = skuXMm + gapQrSku;
  const qrYMm = Math.min(
    Math.max(1, H - qrSizeMm - 1),
    Math.max(1, (H - qrSizeMm) / 2 + PORTRAIT_QR_Y_ADJUST_MM),
  );

  const centerY = (lenMm: number) => Math.max(1, (H - lenMm) / 2);

  const labels: CtLabel[] = [];
  for (const sku of product.skus) {
    const copies = qtyBySku[sku.id] ?? 0;
    if (copies <= 0) continue;
    const code = sku.barcode;
    labels.push({
      qr: sku.barcode,
      copies,
      texts: [
        {
          xMm: skuXMm,
          yMm: centerY(textWidthMm(code, 1, dpi)) + PORTRAIT_SKU_Y_ADJUST_MM,
          scale: 1,
          rotate: PORTRAIT_TEXT_ROTATE,
          text: code,
        },
      ],
    });
  }
  return { widthMm: W, heightMm: H, dpi, qrXMm, qrYMm, qrCell, labels };
}

/** 该任务总标签张数 */
export function totalLabelCount(job: CtPrintJob): number {
  return job.labels.reduce((s, l) => s + l.copies, 0);
}
