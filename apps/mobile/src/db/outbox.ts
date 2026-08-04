import type { CreateSaleOrderInput } from "@cloth-scan/shared";
import { getDb } from "./database";

export interface OutboxItem {
  opId: string;
  kind: string;
  payload: string;
  status: "pending" | "synced" | "failed";
  error: string | null;
  createdAt: string;
  syncedAt: string | null;
}

/** 把一笔销售写入待同步队列（离线也能下单） */
export async function enqueueSale(input: CreateSaleOrderInput): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO outbox (opId, kind, payload, status, createdAt)
     VALUES (?, 'sale', ?, 'pending', ?)`,
    [input.opId, JSON.stringify(input), new Date().toISOString()],
  );
}

export async function listPendingOps(): Promise<OutboxItem[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxItem>(
    `SELECT * FROM outbox WHERE status = 'pending' ORDER BY createdAt ASC`,
  );
}

export async function markOpSynced(opId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status = 'synced', syncedAt = ?, error = NULL WHERE opId = ?`,
    [new Date().toISOString(), opId],
  );
}

export async function markOpFailed(opId: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE outbox SET status = 'failed', error = ? WHERE opId = ?`, [error, opId]);
}

export async function countPendingOps(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM outbox WHERE status = 'pending'`,
  );
  return row?.n ?? 0;
}

/** 同步失败（4xx 永久失败）的 op 数量，用于首页警告条徽标 */
export async function countFailedOps(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM outbox WHERE status = 'failed'`,
  );
  return row?.n ?? 0;
}

/** 列出全部失败 op，按时间倒序，供同步异常列表展示 */
export async function listFailedOps(): Promise<OutboxItem[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxItem>(
    `SELECT * FROM outbox WHERE status = 'failed' ORDER BY createdAt DESC`,
  );
}

/**
 * 重试某笔失败 op：状态改回 pending、清空错误信息，
 * 同步引擎下一轮（poll 或 syncNow）会重新拾取。
 * opId 不变，服务端按 opId 幂等去重，不会重复入账。
 */
export async function retryOp(opId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status = 'pending', error = NULL, syncedAt = NULL WHERE opId = ?`,
    [opId],
  );
}

/** 永久放弃某笔失败 op：从队列删除，不再同步。 */
export async function abandonOp(opId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox WHERE opId = ?`, [opId]);
}

/**
 * 返回当前 pending（未同步）的 outbox 里所有涉及的 skuId（从 payload 解析）。
 * 用于 pull 时跳过这些 SKU 的 stock 覆盖，避免乐观扣被服务端旧值冲掉（D1）。
 */
export async function listPendingSkuIds(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ payload: string }>(
    `SELECT payload FROM outbox WHERE status = 'pending'`,
  );
  const ids = new Set<string>();
  for (const r of rows) {
    try {
      const payload = JSON.parse(r.payload) as { items?: { skuId: string }[] };
      for (const it of payload.items ?? []) ids.add(it.skuId);
    } catch {
      /* 忽略损坏 payload */
    }
  }
  return ids;
}
