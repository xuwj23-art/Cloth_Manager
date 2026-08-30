import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import type {
  AuthResponse,
  AuthUser,
  ChangePasswordInput,
  CreateStaffInput,
  JwtPayload,
  LoginInput,
  RegisterInput,
  ResetStaffPasswordInput,
  ShopMember,
  UpdateMyNameInput,
  UpdateShopNameInput,
} from "@cloth-scan/shared";
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { decryptPassword, encryptPassword } from "./password-cipher";

/**
 * 登录失败限速（内存滑动窗口）：15 分钟内同一手机号连续失败 5 次即锁定。
 * 后端公网明文暴露，无此防护可对 11 位手机号在线暴力破解。
 * 单实例部署够用；进程重启计数清零可接受。Map 设上限防被轮换手机号撑爆内存。
 */
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAP_CAP = 10_000;
const loginFailures = new Map<string, number[]>();

/** 返回剩余锁定毫秒（0=未锁定），顺带清理窗口外记录 */
function loginLockRemaining(phone: string): number {
  const now = Date.now();
  const fails = (loginFailures.get(phone) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  loginFailures.set(phone, fails);
  if (fails.length < LOGIN_MAX_FAILURES) return 0;
  return LOGIN_WINDOW_MS - (now - fails[0]!);
}

function recordLoginFailure(phone: string): number {
  if (loginFailures.size > LOGIN_MAP_CAP) loginFailures.clear();
  const fails = (loginFailures.get(phone) ?? []).filter((t) => Date.now() - t < LOGIN_WINDOW_MS);
  fails.push(Date.now());
  loginFailures.set(phone, fails);
  return fails.length;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private async toAuthResponse(user: User): Promise<AuthResponse> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: user.shopId },
      select: { name: true },
    });
    const payload: JwtPayload = {
      sub: user.id,
      shopId: user.shopId,
      role: user.role,
    };
    return {
      token: this.jwt.sign(payload),
      user: {
        id: user.id,
        shopId: user.shopId,
        shopName: shop?.name ?? "",
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
    };
  }

  /** 注册：开通门店并创建老板账号 */
  async register(input: RegisterInput): Promise<AuthResponse> {
    // 注册邀请码校验：未配置 REGISTER_CODE 时视为关闭注册，避免陌生人占用服务器
    const expected = process.env.REGISTER_CODE;
    if (!expected) {
      throw new ForbiddenException("当前未开放注册，请联系管理员");
    }
    if (input.inviteCode !== expected) {
      throw new ForbiddenException("注册邀请码不正确");
    }

    const exists = await this.prisma.user.findUnique({
      where: { phone: input.phone },
    });
    if (exists) {
      throw new ConflictException("该手机号已注册");
    }
    const passwordHash = await bcrypt.hash(input.password, 10);

    // 并发同号注册：DB unique 兜底，把 P2002 转成 409 而不是 500
    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const shop = await tx.shop.create({ data: { name: input.shopName } });
        return tx.user.create({
          data: {
            shopId: shop.id,
            name: input.name,
            phone: input.phone,
            passwordHash,
            passwordCipher: encryptPassword(input.password),
            role: "owner",
          },
        });
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") {
        throw new ConflictException("该手机号已注册");
      }
      throw e;
    }

    // 建号前的试错（账号不存在也计失败次数）不该把新账号锁在门外
    loginFailures.delete(input.phone);
    return this.toAuthResponse(user);
  }

  /** 登录 */
  async login(input: LoginInput): Promise<AuthResponse> {
    const lockMs = loginLockRemaining(input.phone);
    if (lockMs > 0) {
      throw new HttpException(
        `登录失败次数过多，请 ${Math.ceil(lockMs / 60000)} 分钟后再试`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { phone: input.phone },
    });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      const fails = recordLoginFailure(input.phone);
      const left = Math.max(0, LOGIN_MAX_FAILURES - fails);
      // 提前告知剩余机会，避免用户在不知情时攒满 5 次被锁 15 分钟
      throw new UnauthorizedException(
        left > 0 ? `手机号或密码错误，还可尝试 ${left} 次` : "手机号或密码错误",
      );
    }
    loginFailures.delete(input.phone); // 成功登录清零计数
    return this.toAuthResponse(user);
  }

  /** 老板创建店员账号 */
  async createStaff(shopId: string, input: CreateStaffInput): Promise<AuthResponse> {
    const exists = await this.prisma.user.findUnique({
      where: { phone: input.phone },
    });
    if (exists) {
      throw new ConflictException("该手机号已注册");
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          shopId,
          name: input.name,
          phone: input.phone,
          passwordHash,
          passwordCipher: encryptPassword(input.password),
          role: "staff",
        },
      });
    } catch (e) {
      // 并发创建同号店员：DB unique 兜底转 409
      if ((e as { code?: string })?.code === "P2002") {
        throw new ConflictException("该手机号已注册");
      }
      throw e;
    }
    // 建号前的试错不该把新店员锁在门外（常见：老板还没建完号，店员已在登录页试了几次）
    loginFailures.delete(input.phone);
    return this.toAuthResponse(user);
  }

  /** 列出本门店成员（店主与店员），按创建时间升序 */
  async listMembers(shopId: string): Promise<ShopMember[]> {
    const users = await this.prisma.user.findMany({
      where: { shopId },
      orderBy: { createdAt: "asc" },
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  /** 老板删除店员账号（不能删除店主，也不能删自己） */
  async deleteStaff(shopId: string, targetId: string): Promise<{ ok: true }> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
    });
    if (!target || target.shopId !== shopId) {
      throw new NotFoundException("成员不存在");
    }
    if (target.role === "owner") {
      throw new ForbiddenException("不能删除店主账号");
    }
    await this.prisma.user.delete({ where: { id: targetId } });
    return { ok: true };
  }

  /** 修改自己的密码（仅店主走此接口，需验证原密码） */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new UnauthorizedException();
    if (!(await bcrypt.compare(input.oldPassword, user.passwordHash))) {
      throw new UnauthorizedException("原密码不正确");
    }
    if (input.oldPassword === input.newPassword) {
      throw new ConflictException("新密码不能与原密码相同");
    }
    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordCipher: encryptPassword(input.newPassword) },
    });
    loginFailures.delete(user.phone); // 改密成功清掉旧密码时代的失败计数
    // 注意：JWT 无撤销机制，已签发 token 在过期前仍有效；
    // 设备级吊销待 tokenEpoch 方案（安全审查 P1-3）再收口。
    return { ok: true };
  }

  /** 店主重置店员密码（无需原密码；目标须为本店店员） */
  async resetStaffPassword(
    shopId: string,
    targetId: string,
    input: ResetStaffPasswordInput,
  ): Promise<{ ok: true }> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
    });
    if (!target || target.shopId !== shopId) {
      throw new NotFoundException("成员不存在");
    }
    if (target.role === "owner") {
      throw new ForbiddenException("不能通过此接口重置店主密码");
    }
    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    await this.prisma.user.update({
      where: { id: target.id },
      data: { passwordHash, passwordCipher: encryptPassword(input.newPassword) },
    });
    loginFailures.delete(target.phone); // 重置后清失败计数，店员拿到新密码即可立即登录
    return { ok: true };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return (await this.toAuthResponse(user)).user;
  }

  /** 查看自己的密码（设置页眼睛图标）：返回可逆副本明文；旧密码无副本/未配置密钥返回 null */
  async getMyPassword(userId: string): Promise<{ password: string | null }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return { password: decryptPassword(user.passwordCipher) };
  }

  /** 修改自己的名字（店主/店员均可）。返回刷新后的用户信息供前端即时更新会话。 */
  async updateMyName(userId: string, input: UpdateMyNameInput): Promise<AuthUser> {
    let user: User;
    try {
      user = await this.prisma.user.update({
        where: { id: userId },
        data: { name: input.name },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2025") throw new UnauthorizedException();
      throw e;
    }
    return (await this.toAuthResponse(user)).user;
  }

  /** 店主修改注册店铺名。返回刷新后的用户信息（含新 shopName）。 */
  async updateShopName(shopId: string, input: UpdateShopNameInput): Promise<AuthUser> {
    const owner = await this.prisma.user.findFirst({ where: { shopId, role: "owner" } });
    if (!owner) throw new UnauthorizedException();
    try {
      await this.prisma.shop.update({ where: { id: shopId }, data: { name: input.shopName } });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2025") throw new NotFoundException("门店不存在");
      throw e;
    }
    return (await this.toAuthResponse(owner)).user;
  }
}
