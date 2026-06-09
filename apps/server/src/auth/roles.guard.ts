import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { UserRole } from "@cloth-scan/shared";
import { ROLES_KEY } from "./roles.decorator";
import type { RequestUser } from "./auth.types";

/** 配合 @Roles() 使用；须放在 JwtAuthGuard 之后 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser }>();
    const user = req.user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException("无权限执行该操作");
    }
    return true;
  }
}
