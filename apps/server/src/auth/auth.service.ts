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
  ChangePasswordInput,
  CreateStaffInput,
  JwtPayload,
  LoginInput,
  RegisterInput,
  ResetStaffPasswordInput,
  ShopMember,
} from "@cloth-scan/shared";
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

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

function recordLoginFailure(phone: string): void {
  if (loginFailures.size > LOGIN_MAP_CAP) loginFailures.clear();
  const fails = loginFailures.get(phone) ?? [];
  fails.push(Date.now());
  loginFailures.set(phone, fails);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private toAuthResponse(user: User): AuthResponse {
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
      recordLoginFailure(input.phone);
      throw new UnauthorizedException("手机号或密码错误");
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
      where: { id: userId },
      data: { passwordHash },
    });
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
      where: { id: targetId },
      data: { passwordHash },
    });
    return { ok: true };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      shopId: user.shopId,
      name: user.name,
      phone: user.phone,
      role: user.role,
    };
  }
}
