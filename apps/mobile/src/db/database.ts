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
      `);
      return db;
    })();
  }
  return dbPromise;
}
