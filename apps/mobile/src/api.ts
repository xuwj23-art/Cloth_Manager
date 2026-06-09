import type {
  AuthResponse,
  AuthUser,
  CreateProductInput,
  CreateSaleOrderInput,
  CreateStaffInput,
  LoginInput,
  Product,
  ProductScope,
  ProductWithSkus,
  RegisterInput,
  UpdateProductInput,
  SaleOrderDetail,
  SaleOrderWithItems,
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

let authToken: string | null = null;

/** 设置/清除全局鉴权 token（由 AuthContext 调用） */
export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
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

/* ------------------------------- 业务 ------------------------------- */

export function getHealth(): Promise<{ status: string; db: string; time: string }> {
  return request("/health");
}

/** 扫码匹配：根据 QR/条码获取 SKU 及所属商品 */
export function findSkuByBarcode(barcode: string): Promise<SkuWithProduct> {
  return request(`/skus/by-barcode/${encodeURIComponent(barcode)}`);
}

/** 新建商品款（含批量 SKU） */
export function createProduct(
  input: CreateProductInput,
): Promise<ProductWithSkus> {
  return request("/products", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 商品列表（scope: active 在售 / archived 已售罄 / all 全部） */
export function listProducts(
  scope: ProductScope = "active",
): Promise<ProductWithSkus[]> {
  return request(`/products?scope=${scope}`);
}

/** 编辑商品（改名/改价/盘点改库存） */
export function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<ProductWithSkus> {
  return request(`/products/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** 手动下架 / 恢复在售 */
export function setProductArchived(
  id: string,
  archived: boolean,
): Promise<ProductWithSkus> {
  return request(
    `/products/${encodeURIComponent(id)}/${archived ? "archive" : "unarchive"}`,
    { method: "POST" },
  );
}

/** 新手一键体验：为空门店灌入演示商品（仅店主） */
export function seedDemoData(): Promise<{
  created: number;
  products: ProductWithSkus[];
}> {
  return request("/products/demo", { method: "POST" });
}

/** 提交销售（幂等：相同 opId 不会重复扣库存） */
export function createSale(
  input: CreateSaleOrderInput,
): Promise<SaleOrderWithItems> {
  return request("/sales", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 销售流水（最近 100 笔，含明细名称与操作人） */
export function listSales(): Promise<SaleOrderDetail[]> {
  return request("/sales");
}

/** 单据详情 */
export function getSale(id: string): Promise<SaleOrderDetail> {
  return request(`/sales/${encodeURIComponent(id)}`);
}

/** 销售报表汇总（今日/本周 + 近 7 天热销） */
export function getSalesSummary(): Promise<SalesSummary> {
  return request("/sales/summary");
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

  const res = await fetch(`${API_BASE}/uploads`, {
    method: "POST",
    headers, // 不要手动设 Content-Type，让 fetch 自动带 multipart boundary
    body: form,
  });
  if (!res.ok) throw new Error(`上传失败 HTTP ${res.status}`);
  const data = (await res.json()) as { url: string };
  return data.url;
}
