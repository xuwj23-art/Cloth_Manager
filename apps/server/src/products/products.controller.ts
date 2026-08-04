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
import { CreateProductInput, UpdateProductInput } from "@cloth-scan/shared";
import type { ProductScope } from "@cloth-scan/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/auth.types";
import { ProductsService } from "./products.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** 建档为店主专属（店员仅收银/查看） */
  @Post("products")
  @Roles("owner")
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateProductInput)) body: CreateProductInput,
  ) {
    return this.products.createProduct(user.shopId, body);
  }

  @Get("products")
  list(
    @CurrentUser() user: RequestUser,
    @Query("scope") scope?: ProductScope,
  ) {
    return this.products.listProducts(user.shopId, scope ?? "active");
  }

  /** 新手一键体验：为空门店灌入演示商品（仅店主） */
  @Post("products/demo")
  @Roles("owner")
  seedDemo(@CurrentUser() user: RequestUser) {
    return this.products.seedDemo(user.shopId);
  }

  /** 编辑商品（仅店主）：改名/改价/盘点改库存 */
  @Patch("products/:id")
  @Roles("owner")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateProductInput)) body: UpdateProductInput,
  ) {
    return this.products.updateProduct(user.shopId, id, body);
  }

  /** 手动下架（仅店主） */
  @Post("products/:id/archive")
  @Roles("owner")
  archive(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.products.setArchived(user.shopId, id, true);
  }

  /** 恢复在售（仅店主） */
  @Post("products/:id/unarchive")
  @Roles("owner")
  unarchive(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.products.setArchived(user.shopId, id, false);
  }

  /** 软删除商品：置 deletedAt（须先 archived）。不删除任何图片，保留历史账单可看图（PRD §7 规则 5）。 */
  @Delete("products/:id")
  @Roles("owner")
  remove(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.products.deleteProduct(user.shopId, id);
  }

  @Get("skus/by-barcode/:barcode")
  findByBarcode(
    @CurrentUser() user: RequestUser,
    @Param("barcode") barcode: string,
  ) {
    return this.products.findByBarcode(user.shopId, barcode);
  }
}
