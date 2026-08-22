import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { JwtPayload } from "@cloth-scan/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "./auth.types";

/**
 * 无状态 JWT 校验 + 用户存在性回查。
 *
 * 回查是必须的：token 有效期 30 天且无撤销机制，若店员被删除后不回查，
 * 其手中 token 在过期前仍可调用扫码/开单等资金相关接口。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      throw new UnauthorizedException("缺少登录凭证");
    }
    const token = auth.slice("Bearer ".length);
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException("登录已过期，请重新登录");
    }
    // 回查用户：已删除（如离职店员）立即失效；同时校验角色未被篡改场景下的最新角色
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, shopId: true, role: true },
    });
    if (!user || user.shopId !== payload.shopId) {
      throw new UnauthorizedException("账号不存在或已失效");
    }
    const requestUser: RequestUser = {
      id: user.id,
      shopId: user.shopId,
      role: user.role,
    };
    (req as Request & { user: RequestUser }).user = requestUser;
    return true;
  }
}
