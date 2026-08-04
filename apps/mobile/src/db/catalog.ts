import type { ProductWithSkus, ScannedSku } from "@cloth-scan/shared";
import { getDb } from "./database";

export interface CachedSku {
  barcode: string;
  skuId: string;
  productId: string;
  productName: string;
  color: string;
  size: string;
  salePrice: number;
  stock: number;
  coverImage: string | null;
}

/**
 * 用服务端商品列表刷新本地目录缓存（离线扫码匹配依赖它）。
 *
 * @param pendingSkuIds 仍处于 pending outbox 中的 skuId 集合。
 *   对这些 SKU，**不覆盖本地 stock**（保留 doCheckout 的乐观扣减值），
 *   仅更新 name/price/coverImage/barcode/updatedAt 等字段。
 *   待 push 成功后服务端已扣减，下次 pull 会用正确值覆盖。
 *   目的：消除"pull 早于 push 到达 → stock 跳回 → 短暂超卖"的竞态（D1）。
 */
export async function upsertCatalog(
  products: ProductWithSkus[],
  pendingSkuIds: Set<string> = new Set(),
): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  let count = 0;
  await db.withTransactionAsync(async () => {
    for (const p of products) {
      for (const s of p.skus) {
        if (pendingSkuIds.has(s.id)) {
          // 该 SKU 有未推送的销售：保留本地乐观 stock。
          // 先 INSERT OR IGNORE 确保行存在（新 SKU 场景，stock 占位为 0），
          // 再 UPDATE 除 stock 外的字段。
          await db.runAsync(
            `INSERT OR IGNORE INTO skus_cache
               (barcode, skuId, productId, productName, color, size, salePrice, stock, coverImage, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            [s.barcode, s.id, p.id, p.name, s.color, s.size, s.salePrice, p.coverImage, now],
          );
          await db.runAsync(
            `UPDATE skus_cache
               SET skuId = ?, productId = ?, productName = ?, color = ?, size = ?,
                   salePrice = ?, coverImage = ?, updatedAt = ?
             WHERE barcode = ?`,
            [s.id, p.id, p.name, s.color, s.size, s.salePrice, p.coverImage, now, s.barcode],
          );
        } else {
          await db.runAsync(
            `INSERT OR REPLACE INTO skus_cache
               (barcode, skuId, productId, productName, color, size, salePrice, stock, coverImage, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              s.barcode,
              s.id,
              p.id,
              p.name,
              s.color,
              s.size,
              s.salePrice,
              s.stock,
              p.coverImage,
              now,
            ],
          );
        }
        count++;
      }
    }
  });
  return count;
}

/** 本地优先扫码匹配 */
export async function getCachedSkuByBarcode(barcode: string): Promise<CachedSku | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<CachedSku>(
    `SELECT barcode, skuId, productId, productName, color, size, salePrice, stock, coverImage
       FROM skus_cache WHERE barcode = ?`,
    [barcode],
  );
  return row ?? null;
}

/**
 * 按条码批量删除本地缓存（D3：清理服务端已软删的商品）。
 * 调用方应先扣除 pending outbox 涉及的 skuId 对应条码，避免删掉用户刚卖掉
 * 但服务端同步窗口内被删的 SKU（极端边界，安全冗余）。
 *
 * 空列表直接返回，避免 `WHERE barcode IN ()` SQL 语法错。
 */
export async function deleteSkusByBarcodes(barcodes: string[]): Promise<number> {
  if (barcodes.length === 0) return 0;
  const db = await getDb();
  const placeholders = barcodes.map(() => "?").join(",");
  await db.runAsync(`DELETE FROM skus_cache WHERE barcode IN (${placeholders})`, barcodes);
  return barcodes.length;
}

/**
 * 查询本地缓存里 skuId 命中给定集合的 barcode 列表（用于增量同步删除前的
 * pending 排除：见 sync.ts pullCatalog）。空集合直接返回空数组。
 */
export async function barcodesForSkuIds(skuIds: Set<string>): Promise<string[]> {
  if (skuIds.size === 0) return [];
  const db = await getDb();
  const ids = [...skuIds];
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.getAllAsync<{ barcode: string }>(
    `SELECT barcode FROM skus_cache WHERE skuId IN (${placeholders})`,
    ids,
  );
  return rows.map((r) => r.barcode);
}

/** 乐观地调整本地库存（离线下单后立即反映） */
export async function applyLocalStockDelta(skuId: string, delta: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE skus_cache SET stock = stock + ? WHERE skuId = ?`, [delta, skuId]);
}

export async function countCachedSkus(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM skus_cache`);
  return row?.n ?? 0;
}

/** CachedSku -> 购物车可用的 ScannedSku */
export function toScannedSku(c: CachedSku): ScannedSku {
  return {
    skuId: c.skuId,
    barcode: c.barcode,
    productName: c.productName,
    color: c.color,
    size: c.size,
    price: c.salePrice,
    stock: c.stock,
  };
}
