import {
  ConflictException,
  Injectable,
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
