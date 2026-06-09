import type { ProductWithSkus } from "@cloth-scan/shared";
import type { CtLabel, CtPrintJob } from "../../modules/ct-printer/src/CtPrinter.types";

export interface LabelSizeMm {
  widthMm: number;
  heightMm: number;
}

export const DEFAULT_LABEL_SIZE: LabelSizeMm = { widthMm: 60, heightMm: 40 };

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/**
 * 把商品 + 各 SKU 打印份数，排版成一次蓝牙打印任务。
 * 布局（60×40 为基准）：左侧二维码，右侧三行文本（品名 / 颜色尺码 / 价格）。
 * 坐标用 mm，DPI 在原生侧换算成点，确保 203/300dpi 通用。
 */
export function buildCtPrintJob(
  product: ProductWithSkus,
  qtyBySku: Record<string, number>,
  opts?: { size?: LabelSizeMm; dpi?: number },
): CtPrintJob {
  const size = opts?.size ?? DEFAULT_LABEL_SIZE;
  const dpi = opts?.dpi ?? 203;
  const textX = Math.round(size.widthMm * 0.46); // 二维码占左侧约 45%
  const name = product.name.length > 12 ? `${product.name.slice(0, 11)}…` : product.name;

  const labels: CtLabel[] = [];
  for (const sku of product.skus) {
    const copies = qtyBySku[sku.id] ?? 0;
    if (copies <= 0) continue;
    labels.push({
      qr: sku.barcode,
      copies,
      texts: [
        { xMm: textX, yMm: 3, scale: 1, text: name },
        { xMm: textX, yMm: 13, scale: 1, text: `${sku.color}/${sku.size}` },
        { xMm: textX, yMm: 24, scale: 2, text: yuan(sku.salePrice) },
      ],
    });
  }

  return {
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    dpi,
    qrXMm: 3,
    qrYMm: 3,
    qrCell: 5,
    labels,
  };
}

/** 该任务总标签张数 */
export function totalLabelCount(job: CtPrintJob): number {
  return job.labels.reduce((s, l) => s + l.copies, 0);
}
