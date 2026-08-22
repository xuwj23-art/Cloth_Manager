import type { CreateSaleOrderInput } from "@cloth-scan/shared";
import { ApiError, createSale, getHealth, listProductsForSync } from "../api";
import { barcodesForSkuIds, deleteSkusByBarcodes, upsertCatalog } from "../db/catalog";
import { LAST_SYNCED_AT_KEY, getSyncMeta, setSyncMeta } from "../db/database";
import { listPendingOps, listPendingSkuIds, markOpFailed, markOpSynced } from "../db/outbox";

/** 简单联网检测：健康接口带超时探活，失败/超时即视为离线 */
export async function isOnline(timeoutMs = 3000): Promise<boolean> {
  try {
    await getHealth(timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * 增量拉取：自上次同步的 serverTime 起仅拉变更 + 清理已删商品缓存（D2 + D3）。
 *
 * 流程：
 * 1. 读 lastSyncedAt（无 → undefined，触发首次全量同步）
 * 2. 调 listProductsForSync(since) 拿增量商品 + deletedBarcodes + 新 serverTime
 * 3. upsertCatalog(products, pendingSkuIds)：保留 pending SKU 的乐观 stock（D1，Wave2 Task5）
 * 4. 从 deletedBarcodes 中扣除 pendingSkuIds 对应条码（安全冗余：不删用户刚卖的 SKU）
 *    再 deleteSkusByBarcodes 清理（D3：原先 skus_cache 永不清理已删）
 * 5. 把 serverTime 写回 lastSyncedAt，作为下次 since
 *
 * 注意：只有 1-4 全部成功后才更新 lastSyncedAt；中途抛错保留旧值以便下次重试。
 *
 * @param pendingSkuIds 仍 pending 的 outbox 涉及的 skuId；对这些 SKU 保留本地乐观
 *   stock，避免 pull 早于 push 到达时把扣减值冲掉（D1）。未传则内部自行读取。
 * @returns 本次 upsert 的 SKU 行数（不含删除）
 */
export async function pullCatalog(pendingSkuIds?: Set<string>): Promise<number> {
  const pending = pendingSkuIds ?? (await listPendingSkuIds());
  const since = await getSyncMeta(LAST_SYNCED_AT_KEY);
  const res = await listProductsForSync(since ?? undefined);
  const upserted = await upsertCatalog(res.products, pending);

  // 安全过滤：剔除 pending outbox 涉及的 barcode，避免删掉用户刚卖掉但服务端
  // 同步窗口内被删的 SKU（极端边界，纯防御）
  if (res.deletedBarcodes.length > 0) {
    const pendingBarcodes = new Set(await barcodesForSkuIds(pending));
    const toDelete = res.deletedBarcodes.filter((b) => !pendingBarcodes.has(b));
    await deleteSkusByBarcodes(toDelete);
  }

  // 全部成功后再更新 lastSyncedAt；抛错则保留旧值下次重试
  await setSyncMeta(LAST_SYNCED_AT_KEY, res.serverTime);
  return upserted;
}

export interface PushResult {
  synced: number;
  failed: number;
  remaining: number;
}

/**
 * 根据错误类型决定 outbox op 的下一状态：
 * - 400/404/409/422 业务性拒绝（库存不足、SKU 已删/不存在、幂等冲突、参数错）→ failed（不再重试）
 * - 其它 HTTP 状态（401/403/5xx 等）或网络错/超时 → pending（下次重试）
 *
 * 注意：404 必须归 failed——离线单引用的 SKU 已被删除时，服务端返回 404，
 * 若保留 pending 会变成每 15s 空推一次、且不出现在同步异常列表的「僵尸单」。
 * 401/403 多为可恢复（重新登录）场景，保留 pending。
 *
 * @param status ApiError.status（数字，0=超时）或 "network"（非 ApiError，视为网络故障）
 */
export function classifySyncError(status: number | "network"): "failed" | "pending" {
  if (status === "network") return "pending";
  if (status === 400 || status === 404 || status === 409 || status === 422) return "failed";
  return "pending"; // 401/403/5xx/超时(0) → 重试
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
      const status: number | "network" = e instanceof ApiError ? e.status : "network";
      if (classifySyncError(status) === "failed") {
        await markOpFailed(op.opId, e instanceof Error ? e.message : String(e));
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
  // pull 前抓一次 pending 涉及的 skuId，确保即便 push 后仍有残留 pending
  // （网络/5xx），pull 也不会覆盖这些 SKU 的本地乐观 stock（D1）。
  const pendingSkuIds = await listPendingSkuIds();
  const pulled = await pullCatalog(pendingSkuIds);
  return { push, pulled };
}
