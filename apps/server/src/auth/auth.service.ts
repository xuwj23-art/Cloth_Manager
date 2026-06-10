import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import type {
  AuthResponse,
  CreateStaffInput,
  JwtPayload,
  LoginInput,
  RegisterInput,
  ShopMember,
} from "@cloth-scan/shared";
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

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

    const user = await this.prisma.$transaction(async (tx) => {
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

    return this.toAuthResponse(user);
  }

  /** 登录 */
  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { phone: input.phone },
    });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException("手机号或密码错误");
    }
    return this.toAuthResponse(user);
  }

  /** 老板创建店员账号 */
  async createStaff(
    shopId: string,
    input: CreateStaffInput,
  ): Promise<AuthResponse> {
    const exists = await this.prisma.user.findUnique({
      where: { phone: input.phone },
    });
    if (exists) {
      throw new ConflictException("该手机号已注册");
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.prisma.user.create({
      data: {
        shopId,
        name: input.name,
        phone: input.phone,
        passwordHash,
        role: "staff",
      },
    });
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
