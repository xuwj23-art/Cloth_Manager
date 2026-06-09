import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { JwtPayload } from "@cloth-scan/shared";
import type { RequestUser } from "./auth.types";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      throw new UnauthorizedException("缺少登录凭证");
    }
    const token = auth.slice("Bearer ".length);
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      const user: RequestUser = {
        id: payload.sub,
        shopId: payload.shopId,
        role: payload.role,
      };
      (req as Request & { user: RequestUser }).user = user;
      return true;
    } catch {
      throw new UnauthorizedException("登录已过期，请重新登录");
    }
  }
}
