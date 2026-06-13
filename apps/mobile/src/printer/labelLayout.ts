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

/** TSPL 价格用全角￥，多数热敏机的中文字库都含该字形，避免缺字 */
function yuanLabel(cents: number): string {
  return `￥${(cents / 100).toFixed(2)}`;
}

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
 *  - landscape（正排）：二维码居中靠上，SKU、价格在下方居中。
 *  - portrait（纵向）：把内容旋转 90° 印在 60×40 横版纸上——二维码在打印画布左侧
 *    （占满 40mm 高、尽量大），SKU/价格文本旋转 90° 排在右侧。打印出来后把标签
 *    转 90° 拿在手里，即是「二维码在上、SKU、价格在下」的纵向标签（40 宽 × 60 高）。
 *
 * 注：二维码尺寸随条码长度变化，按估算值居中；首次实物试打如有偏移，可微调
 * 下方常量（portrait 文本若上下颠倒/错位，把 PORTRAIT_TEXT_ROTATE 在 90/270 之间切换）。
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
    product.skus.find((s) => (qtyBySku[s.id] ?? 0) > 0)?.barcode ??
    product.skus[0]?.barcode ??
    "";
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

/** 正排（横版）：二维码居中靠上，SKU、价格在下方居中 */
function buildLandscape(
  product: ProductWithSkus,
  qtyBySku: Record<string, number>,
  ctx: BuildCtx & { qrXAdjustMm: number },
): CtPrintJob {
  const { W, H, dpi, dotsPerMm, modules, wantCell, qrXAdjustMm } = ctx;
  // 二维码尺寸：宽度不超出标签，且给下方两行文本留约 11mm
  const maxCell = Math.max(
    3,
    Math.floor((Math.min(W - 4, H - 11) * dotsPerMm) / modules),
  );
  const qrCell = Math.min(wantCell, maxCell);
  const qrSizeMm = (modules * qrCell) / dotsPerMm;

  const qrYMm = 2;
  const qrXMm = Math.max(1, (W - qrSizeMm) / 2 + qrXAdjustMm);
  const codeYMm = qrYMm + qrSizeMm + 1.5;
  const priceYMm = codeYMm + 4.5;
  const centerX = (w: number) => Math.max(1, (W - w) / 2);

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
  return { widthMm: W, heightMm: H, dpi, qrXMm, qrYMm, qrCell, labels };
}

/** portrait 文本旋转角度；若实物上下颠倒/错位，在 90 / 270 间切换 */
const PORTRAIT_TEXT_ROTATE = 90;

/**
 * 纵向（旋转 90°）：在 60×40 横版画布上把内容旋转 90° 排版。
 *
 * 坐标说明（已据实物照片校准）：
 *  - 画布 X 轴(0..W) 对应「拿在手里的纵向标签」的上下方向：X 越大越靠上。
 *    所以「二维码在上 / SKU / 价格在下」⇒ 画布 X：price < sku < 二维码。
 *  - 画布 Y 轴(0..H) 对应纵向标签的左右方向；旋转文本沿 Y 方向延伸，
 *    用 (H - 文本长度)/2 在 H 内居中（之前误用 (H+L)/2 导致贴边/被切）。
 *  - 整组（二维码 + 两行文本）在 X 方向整体居中。
 */
function buildPortrait(
  product: ProductWithSkus,
  qtyBySku: Record<string, number>,
  ctx: BuildCtx,
): CtPrintJob {
  const { W, H, dpi, dotsPerMm, modules, wantCell } = ctx;
  // 二维码尽量大：受限于画布高度 H（纵向标签的宽度），留约 4mm 边距
  const maxCell = Math.max(3, Math.floor(((H - 4) * dotsPerMm) / modules));
  const qrCell = Math.min(wantCell, maxCell);
  const qrSizeMm = (modules * qrCell) / dotsPerMm;

  const gapQrSku = 4; // 二维码 ↔ SKU 行间距（沿 X）
  const gapSkuPrice = 5; // SKU ↔ 价格行间距（沿 X）
  const groupLen = qrSizeMm + gapQrSku + gapSkuPrice;
  const priceXMm = Math.max(2, (W - groupLen) / 2); // 最下（X 最小）
  const skuXMm = priceXMm + gapSkuPrice;
  const qrXMm = skuXMm + gapQrSku; // 最上（X 最大），二维码左下角
  const qrYMm = Math.max(1, (H - qrSizeMm) / 2); // 在 H 内居中

  const centerY = (lenMm: number) => Math.max(1, (H - lenMm) / 2);

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
        {
          xMm: skuXMm,
          yMm: centerY(textWidthMm(code, 1, dpi)),
          scale: 1,
          rotate: PORTRAIT_TEXT_ROTATE,
          text: code,
        },
        {
          xMm: priceXMm,
          yMm: centerY(textWidthMm(price, 1, dpi)),
          scale: 1,
          rotate: PORTRAIT_TEXT_ROTATE,
          text: price,
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
