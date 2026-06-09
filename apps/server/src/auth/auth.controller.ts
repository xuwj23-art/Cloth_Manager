import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import {
  CreateStaffInput,
  LoginInput,
  RegisterInput,
} from "@cloth-scan/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";
import { Roles } from "./roles.decorator";
import { CurrentUser } from "./current-user.decorator";
import type { RequestUser } from "./auth.types";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(
    @Body(new ZodValidationPipe(RegisterInput)) body: RegisterInput,
  ) {
    return this.auth.register(body);
  }

  @Post("login")
  login(@Body(new ZodValidationPipe(LoginInput)) body: LoginInput) {
    return this.auth.login(body);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: RequestUser) {
    return this.auth.getMe(user.id);
  }

  /** 仅老板可查看门店成员 */
  @Get("staff")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner")
  listStaff(@CurrentUser() user: RequestUser) {
    return this.auth.listMembers(user.shopId);
  }

  /** 仅老板可创建店员 */
  @Post("staff")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner")
  createStaff(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateStaffInput)) body: CreateStaffInput,
  ) {
    return this.auth.createStaff(user.shopId, body);
  }
}
