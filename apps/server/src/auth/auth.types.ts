import type { UserRole } from "@cloth-scan/shared";

/** 挂在 request 上的登录态用户 */
export interface RequestUser {
  id: string;
  shopId: string;
  role: UserRole;
}
