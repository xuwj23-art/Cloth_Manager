import * as SQLite from "expo-sqlite";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** 单例打开本地数据库并初始化表结构 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("cloth_scan.db");
      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS skus_cache (
          barcode      TEXT PRIMARY KEY NOT NULL,
          skuId        TEXT NOT NULL,
          productId    TEXT NOT NULL,
          productName  TEXT NOT NULL,
          color        TEXT NOT NULL,
          size         TEXT NOT NULL,
          salePrice    INTEGER NOT NULL,
          stock        INTEGER NOT NULL,
          coverImage   TEXT,
          updatedAt    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS outbox (
          opId      TEXT PRIMARY KEY NOT NULL,
          kind      TEXT NOT NULL,
          payload   TEXT NOT NULL,
          status    TEXT NOT NULL DEFAULT 'pending',
          error     TEXT,
          createdAt TEXT NOT NULL,
          syncedAt  TEXT
        );

        -- 同步元数据（D2 + D3）：存放上次增量同步的 serverTime 等键值对。
        -- 与 skus_cache 同库，确保 sync 状态与其涉及的数据同生共死。
        CREATE TABLE IF NOT EXISTS sync_meta (
          key   TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

/** 上次增量同步成功的 serverTime（下次请求的 since）的 sync_meta 键 */
export const LAST_SYNCED_AT_KEY = "catalogLastSyncedAt";

/** 读取 sync_meta 中某个键的值（不存在返回 null） */
export async function getSyncMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM sync_meta WHERE key = ?`,
    [key],
  );
  return row?.value ?? null;
}

/** 写入 sync_meta（UPSERT） */
export async function setSyncMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}
