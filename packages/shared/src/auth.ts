import { z } from "zod";
import { UserRole } from "./enums";

/** 手机号：中国大陆 11 位 */
export const Phone = z.string().regex(/^1[3-9]\d{9}$/, "请输入有效的手机号");

/** 注册：创建门店 + 老板账号（首次开通） */
export const RegisterInput = z.object({
  shopName: z.string().min(1).max(40),
  name: z.string().min(1).max(20),
  phone: Phone,
  password: z.string().min(6, "密码至少 6 位").max(64),
  /** 注册邀请码：防止陌生人随意注册占用服务器 */
  inviteCode: z.string().min(1, "请输入注册邀请码").max(64),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

/** 登录 */
export const LoginInput = z.object({
  phone: Phone,
  password: z.string().min(1).max(64),
});
export type LoginInput = z.infer<typeof LoginInput>;

/** 老板创建店员账号 */
export const CreateStaffInput = z.object({
  name: z.string().min(1).max(20),
  phone: Phone,
  password: z.string().min(6).max(64),
});
export type CreateStaffInput = z.infer<typeof CreateStaffInput>;

/** 修改自己的密码（登录态，店主/店员均可）。需验证原密码。 */
export const ChangePasswordInput = z.object({
  oldPassword: z.string().min(1, "请输入原密码").max(64),
  newPassword: z.string().min(6, "新密码至少 6 位").max(64),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

/** 店主重置店员密码（无需原密码） */
export const ResetStaffPasswordInput = z.object({
  newPassword: z.string().min(6, "新密码至少 6 位").max(64),
});
export type ResetStaffPasswordInput = z.infer<typeof ResetStaffPasswordInput>;

/** 门店成员（店员管理列表项，不含密码） */
export interface ShopMember {
  id: string;
  name: string;
  phone: string;
  role: z.infer<typeof UserRole>;
  createdAt: string;
}

/** 登录态用户信息（不含密码） */
export const AuthUser = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  shopName: z.string(),
  name: z.string(),
  phone: z.string(),
  role: UserRole,
});
export type AuthUser = z.infer<typeof AuthUser>;

/** JWT 载荷 */
export interface JwtPayload {
  sub: string; // userId
  shopId: string;
  role: z.infer<typeof UserRole>;
}

/** 登录/注册返回 */
export const AuthResponse = z.object({
  token: z.string(),
  user: AuthUser,
});
export type AuthResponse = z.infer<typeof AuthResponse>;
