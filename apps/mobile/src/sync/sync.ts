import type { CreateSaleOrderInput } from "@cloth-scan/shared";
import { ApiError, createSale, getHealth, listProducts } from "../api";
import { upsertCatalog } from "../db/catalog";
import {
  listPendingOps,
  markOpFailed,
  markOpSynced,
} from "../db/outbox";

/** 简单联网检测：尝试访问健康接口（带超时），失败即视为离线 */
export async function isOnline(timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await getHealth();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 拉取：用服务端目录刷新本地缓存（供离线扫码） */
export async function pullCatalog(): Promise<number> {
  const products = await listProducts();
  return upsertCatalog(products);
}

export interface PushResult {
  synced: number;
  failed: number;
  remaining: number;
}

/**
 * 推送：把 outbox 里待同步的销售逐条上传。
 * - 成功 → 标记 synced
 * - 服务端业务拒绝（400/409，如库存不足）→ 标记 failed（不再无限重试）
 * - 网络/5xx → 保留 pending，下次再试
 */
export async function pushOutbox(): Promise<PushResult> {
  const pending = await listPendingOps();
  let synced = 0;
  let failed = 0;
  let remaining = 0;

  for (const op of pending) {
    try {
      const payload = JSON.parse(op.payload) as CreateSaleOrderInput;
      await createSale(payload);
      await markOpSynced(op.opId);
      synced++;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 400 || e.status === 409)) {
        await markOpFailed(op.opId, e.message);
        failed++;
      } else {
        remaining++; // 网络问题，保留待下次同步
      }
    }
  }
  return { synced, failed, remaining };
}

/** 完整同步：先推后拉 */
export async function syncAll(): Promise<{
  push: PushResult;
  pulled: number;
}> {
  const push = await pushOutbox();
  const pulled = await pullCatalog();
  return { push, pulled };
}
