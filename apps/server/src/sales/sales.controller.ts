import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CreateSaleOrderInput, EditSaleOrderInput } from "@cloth-scan/shared";
import type { SalesRange } from "@cloth-scan/shared";
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

  /** 报表（含利润 + 日期下钻）：店主专属。range=today|week|month */
  @Get("report")
  @Roles("owner")
  report(@CurrentUser() user: RequestUser, @Query("range") range?: string) {
    const r: SalesRange =
      range === "week" || range === "month" ? range : "today";
    return this.sales.report(user.shopId, r);
  }

  /** 单据详情：店主专属 */
  @Get(":id")
  @Roles("owner")
  detail(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.sales.getOrder(user.shopId, id);
  }

  /** 编辑账单（改价/改数量/删某件）：店主专属 */
  @Patch(":id")
  @Roles("owner")
  edit(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EditSaleOrderInput)) body: EditSaleOrderInput,
  ) {
    return this.sales.editOrder(user.shopId, id, body);
  }

  /** 删除整单：店主专属（库存回滚） */
  @Delete(":id")
  @Roles("owner")
  remove(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.sales.deleteOrder(user.shopId, id);
  }
}
