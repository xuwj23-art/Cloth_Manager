import type {
  AuthResponse,
  AuthUser,
  CatalogSyncResponse,
  CreateProductInput,
  CreateSaleOrderInput,
  CreateStaffInput,
  EditSaleOrderInput,
  LoginInput,
  MonthlySalesReport,
  Product,
  ProductScope,
  ProductWithSkus,
  RegisterInput,
  UpdateProductInput,
  SaleOrderDetail,
  SaleOrderWithItems,
  SalesRange,
  SalesReport,
  SalesSummary,
  ShopMember,
  Sku,
} from "@cloth-scan/shared";
import { API_BASE, API_HOST } from "./config";

export type SkuWithProduct = Sku & { product: Product };

/** 带 HTTP 状态码的错误，便于同步引擎区分「网络故障」与「服务端业务拒绝」 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 把后端返回的相对图片路径拼成可显示的完整地址 */
export function imageUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  return `${API_HOST}${path}`;
}

/**
 * 缩略图地址：服务器上传时会额外生成同名的 `.thumb.jpg`，
 * 列表/卡片用它省流量、加载更快。大图查看仍用 imageUrl。
 */
export function thumbUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  const thumb = path.replace(/\.[^./]+$/, ".thumb.jpg");
  return `${API_HOST}${thumb}`;
}

let authToken: string | null = null;

/** 设置/清除全局鉴权 token（由 AuthContext 调用） */
export function setAuthToken(token: string | null) {
  authToken = token;
}

/** 默认请求超时（毫秒）：弱网下避免 fetch 长时间挂起拖死同步引擎 */
const DEFAULT_TIMEOUT_MS = 15_000;

/** 带超时的 fetch：超时抛 ApiError(status=0)，同步引擎会归入「网络故障」重试 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new ApiError(0, `请求超时（${Math.round(timeoutMs / 1000)}秒）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetchWithTimeout(`${API_BASE}${path}`, { ...init, headers }, timeoutMs);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) msg = Array.isArray(body.message) ? body.message.join("; ") : body.message;
    } catch {
      // ignore parse error
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ------------------------------- 鉴权 ------------------------------- */

export function apiLogin(input: LoginInput): Promise<AuthResponse> {
  return request("/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function apiRegister(input: RegisterInput): Promise<AuthResponse> {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function apiMe(): Promise<AuthUser> {
  return request("/auth/me");
}

/** 门店成员列表（仅店主） */
export function apiListStaff(): Promise<ShopMember[]> {
  return request("/auth/staff");
}

/** 创建店员账号（仅店主） */
export function apiCreateStaff(input: CreateStaffInput): Promise<AuthResponse> {
  return request("/auth/staff", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 删除店员账号（仅店主） */
export function apiDeleteStaff(id: string): Promise<{ ok: true }> {
  return request(`/auth/staff/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ------------------------------- 业务 ------------------------------- */

/** 健康检查（isOnline 探活用，可用更短超时） */
export function getHealth(
  timeoutMs = 5_000,
): Promise<{ status: string; db: string; time: string }> {
  return request("/health", undefined, timeoutMs);
}

/** 扫码匹配：根据 QR/条码获取 SKU 及所属商品 */
export function findSkuByBarcode(barcode: string): Promise<SkuWithProduct> {
  return request(`/skus/by-barcode/${encodeURIComponent(barcode)}`);
}

/** 新建商品款（含批量 SKU） */
export function createProduct(input: CreateProductInput): Promise<ProductWithSkus> {
  return request("/products", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 商品列表（scope: active 在售 / archived 已售罄 / all 全部） */
export function listProducts(scope: ProductScope = "active"): Promise<ProductWithSkus[]> {
  return request(`/products?scope=${scope}`);
}

/**
 * 增量同步（D2 + D3）：返回自 since 起 updatedAt 有变更的商品 + 被软删商品
 * 的 SKU 条码列表 + 本次服务端时间。since 缺省时为首次全量同步。
 *
 * 与 {@link listProducts} 的区别：仅传增量、附带 deletedBarcodes 供缓存清理。
 */
export function listProductsForSync(since?: string): Promise<CatalogSyncResponse> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  return request(`/products/sync${qs}`);
}

/** 编辑商品（改名/改价/盘点改库存） */
export function updateProduct(id: string, input: UpdateProductInput): Promise<ProductWithSkus> {
  return request(`/products/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** 删除商品（仅店主，需先售罄/下架）：清理图片释放磁盘 */
export function deleteProduct(id: string): Promise<{ ok: true }> {
  return request(`/products/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 手动下架 / 恢复在售 */
export function setProductArchived(id: string, archived: boolean): Promise<ProductWithSkus> {
  return request(`/products/${encodeURIComponent(id)}/${archived ? "archive" : "unarchive"}`, {
    method: "POST",
  });
}

/** 新手一键体验：为空门店灌入演示商品（仅店主） */
export function seedDemoData(): Promise<{
  created: number;
  products: ProductWithSkus[];
}> {
  return request("/products/demo", { method: "POST" });
}

/** 提交销售（幂等：相同 opId 不会重复扣库存） */
export function createSale(input: CreateSaleOrderInput): Promise<SaleOrderWithItems> {
  return request("/sales", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * 销售流水（cursor 分页首页，默认 50 条；含明细名称与操作人）。
 *
 * E7：服务端 listOrders 已改 cursor 分页，响应为 { items, nextCursor }。
 * 移动端当前 UI（SalesScreen / saleAlerts）只需首屏数据，故此处透明取 items，
 * 对调用方保持 `Promise<SaleOrderDetail[]>` 签名不变（向后兼容）。
 * 后续若要做"加载更多"，可新增 listSalesPaged(cursor?) 直接返回带 nextCursor 的结构。
 */
export async function listSales(): Promise<SaleOrderDetail[]> {
  const data = await request<{ items: SaleOrderDetail[]; nextCursor: string | null }>("/sales");
  return data.items;
}

/** 单据详情 */
export function getSale(id: string): Promise<SaleOrderDetail> {
  return request(`/sales/${encodeURIComponent(id)}`);
}

/** 编辑账单（改价/改数量/删某件，仅店主）：库存自动回滚或扣减 */
export function editSaleOrder(
  id: string,
  items: EditSaleOrderInput["items"],
): Promise<SaleOrderDetail> {
  return request(`/sales/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ items }),
  });
}

/** 删除整单（仅店主）：库存回滚 */
export function deleteSaleOrder(id: string): Promise<{ ok: true }> {
  return request(`/sales/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 销售报表汇总（今日/本周 + 近 7 天热销） */
export function getSalesSummary(): Promise<SalesSummary> {
  return request("/sales/summary");
}

/** 销售报表（含利润 + 日期下钻 + 各店员销售额）：range=today|week|month */
export function getSalesReport(range: SalesRange): Promise<SalesReport> {
  return request(`/sales/report?range=${range}`);
}

/** 历史某月销售（按天）：year=2026&month=5（month 1-12） */
export function getMonthlySales(year: number, month: number): Promise<MonthlySalesReport> {
  return request(`/sales/monthly?year=${year}&month=${month}`);
}

/** 某天销售流水（按时间倒序）：date=YYYY-MM-DD */
export function getSalesByDay(date: string): Promise<SaleOrderDetail[]> {
  return request(`/sales/by-day?date=${encodeURIComponent(date)}`);
}

/** 上传图片，返回相对路径（如 /uploads/xxx.jpg） */
export async function uploadImage(localUri: string): Promise<string> {
  const form = new FormData();
  const name = localUri.split("/").pop() ?? "photo.jpg";
  const ext = name.split(".").pop()?.toLowerCase() ?? "jpg";
  form.append("file", {
    uri: localUri,
    name,
    type: `image/${ext === "jpg" ? "jpeg" : ext}`,
  } as unknown as Blob);

  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  // 图片上传可能较慢（弱网 + 8MB 上限），给更长超时
  const res = await fetchWithTimeout(
    `${API_BASE}/uploads`,
    {
      method: "POST",
      headers, // 不要手动设 Content-Type，让 fetch 自动带 multipart boundary
      body: form,
    },
    60_000,
  );
  if (!res.ok) throw new Error(`上传失败 HTTP ${res.status}`);
  const data = (await res.json()) as { url: string };
  return data.url;
}
