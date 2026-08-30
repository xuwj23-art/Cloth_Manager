import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  ChangePasswordInput,
  CreateStaffInput,
  LoginInput,
  RegisterInput,
  ResetStaffPasswordInput,
  UpdateMyNameInput,
  UpdateShopNameInput,
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
  register(@Body(new ZodValidationPipe(RegisterInput)) body: RegisterInput) {
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

  /** 修改自己的名字（店主/店员均可，设置页入口） */
  @Patch("me")
  @UseGuards(JwtAuthGuard)
  updateMyName(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(UpdateMyNameInput)) body: UpdateMyNameInput,
  ) {
    return this.auth.updateMyName(user.id, body);
  }

  /** 修改注册店铺名（仅店主）：改后登录/凭证里的 shopName 即时刷新 */
  @Patch("shop")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner")
  updateShopName(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(UpdateShopNameInput)) body: UpdateShopNameInput,
  ) {
    return this.auth.updateShopName(user.shopId, body);
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

  /** 仅店主可改自己的密码（需原密码）。店员密码只能由店主在店员管理里改。 */
  @Patch("password")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner")
  changeOwnPassword(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(ChangePasswordInput)) body: ChangePasswordInput,
  ) {
    return this.auth.changePassword(user.id, body);
  }

  /** 仅老板可重置店员密码 */
  @Patch("staff/:id/password")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner")
  resetStaffPassword(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ResetStaffPasswordInput))
    body: ResetStaffPasswordInput,
  ) {
    return this.auth.resetStaffPassword(user.shopId, id, body);
  }

  /** 仅老板可删除店员 */
  @Delete("staff/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner")
  deleteStaff(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.auth.deleteStaff(user.shopId, id);
  }
}
