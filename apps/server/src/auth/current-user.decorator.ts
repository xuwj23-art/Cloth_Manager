import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { RequestUser } from "./auth.types";

/** 在控制器里取登录态用户：@CurrentUser() user: RequestUser */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user: RequestUser }>();
    return req.user;
  },
);
