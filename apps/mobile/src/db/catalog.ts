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

/** 用服务端商品列表刷新本地目录缓存（离线扫码匹配依赖它） */
export async function upsertCatalog(products: ProductWithSkus[]): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  let count = 0;
  await db.withTransactionAsync(async () => {
    for (const p of products) {
      for (const s of p.skus) {
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
        count++;
      }
    }
  });
  return count;
}

/** 本地优先扫码匹配 */
export async function getCachedSkuByBarcode(
  barcode: string,
): Promise<CachedSku | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<CachedSku>(
    `SELECT barcode, skuId, productId, productName, color, size, salePrice, stock, coverImage
       FROM skus_cache WHERE barcode = ?`,
    [barcode],
  );
  return row ?? null;
}

/** 乐观地调整本地库存（离线下单后立即反映） */
export async function applyLocalStockDelta(
  skuId: string,
  delta: number,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE skus_cache SET stock = stock + ? WHERE skuId = ?`, [
    delta,
    skuId,
  ]);
}

export async function countCachedSkus(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM skus_cache`,
  );
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
