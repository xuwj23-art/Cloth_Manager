import type { CreateSaleOrderInput } from "@cloth-scan/shared";
import { ApiError, createSale, getHealth, listProducts } from "../api";
import { upsertCatalog } from "../db/catalog";
import {
  listPendingOps,
  listPendingSkuIds,
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

/**
 * 拉取：用服务端目录刷新本地缓存（供离线扫码）。
 *
 * @param pendingSkuIds 仍 pending 的 outbox 涉及的 skuId；对这些 SKU 保留本地乐观
 *   stock，避免 pull 早于 push 到达时把扣减值冲掉（D1）。未传则内部自行读取。
 */
export async function pullCatalog(
  pendingSkuIds?: Set<string>,
): Promise<number> {
  const products = await listProducts();
  const pending = pendingSkuIds ?? (await listPendingSkuIds());
  return upsertCatalog(products, pending);
}

export interface PushResult {
  synced: number;
  failed: number;
  remaining: number;
}

/**
 * 根据错误类型决定 outbox op 的下一状态：
 * - 400/409 业务拒绝（如库存不足、幂等冲突）→ failed（不再重试）
 * - 其它 HTTP 状态（含 5xx、401/403/422 等）或网络错 → pending（下次重试）
 *
 * 注意：仅 400/409 视为「确定不可重试」的业务错；其余即便属 4xx 也保留 pending，
 * 因为鉴权失败（401）、权限不足（403）等多为可恢复（重新登录/重试）场景。
 *
 * @param status ApiError.status（数字）或 "network"（非 ApiError，视为网络故障）
 */
export function classifySyncError(status: number | "network"): "failed" | "pending" {
  if (status === "network") return "pending";
  if (status === 400 || status === 409) return "failed";
  return "pending"; // 5xx 或其它 4xx → 重试
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
      const status: number | "network" =
        e instanceof ApiError ? e.status : "network";
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
