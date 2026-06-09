import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CreateSaleOrderInput } from "@cloth-scan/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/auth.types";
import { SalesService } from "./sales.service";

@Controller("sales")
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /** 开单：店主与店员都可（收银核心动作） */
  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateSaleOrderInput)) body: CreateSaleOrderInput,
  ) {
    return this.sales.createSale(user.shopId, user.id, body);
  }

  /** 流水列表：店主专属（经营数据） */
  @Get()
  @Roles("owner")
  list(@CurrentUser() user: RequestUser) {
    return this.sales.listOrders(user.shopId);
  }

  /** 报表汇总：店主专属 */
  @Get("summary")
  @Roles("owner")
  summary(@CurrentUser() user: RequestUser) {
    return this.sales.getSummary(user.shopId);
  }

  /** 单据详情：店主专属 */
  @Get(":id")
  @Roles("owner")
  detail(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.sales.getOrder(user.shopId, id);
  }
}
