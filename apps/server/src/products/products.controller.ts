import {
  BadRequestException,
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
import { CreateProductInput, RecognizeGarmentInput, UpdateProductInput } from "@cloth-scan/shared";
import type { CatalogSyncResponse, ProductScope } from "@cloth-scan/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/auth.types";
import { ProductsService, redactProductCost, redactSkuCost } from "./products.service";
import { GarmentVisionService } from "./garment-vision.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly vision: GarmentVisionService,
  ) {}

  /** 建档：店主/店员均可。店员提交的进价一律按 0 入库，响应也不回真实进价。 */
  @Post("products")
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateProductInput)) body: CreateProductInput,
  ) {
    const input =
      user.role === "staff"
        ? { ...body, skus: body.skus.map((s) => ({ ...s, costPrice: 0 })) }
        : body;
    const created = await this.products.createProduct(user.shopId, input);
    return user.role === "staff" && created ? redactProductCost(created) : created;
  }

  @Get("products")
  async list(@CurrentUser() user: RequestUser, @Query("scope") scope?: ProductScope) {
    // 显式白名单：乱值直接 400，不落入 else 当 all 处理
    const SCOPES: ProductScope[] = ["active", "archived", "all"];
    const s = (scope ?? "active") as ProductScope;
    if (!SCOPES.includes(s)) {
      throw new BadRequestException(`无效的 scope：${String(scope)}`);
    }
    const list = await this.products.listProducts(user.shopId, s);
    return user.role === "staff" ? list.map((p) => redactProductCost(p)) : list;
  }

  /**
   * 增量同步专用（D2 + D3）：返回自 since 起 updatedAt 有变更的商品 +
   * 被软删商品的 SKU 条码列表 + 本次服务端时间。
   *
   * 注意：本路由必须声明在 `@Get("products/:id")` 之前（当前虽无该路由，
   * 但保留顺序以防后续新增时 `sync` 被 :id 参数捕获）。
   */
  @Get("products/sync")
  async sync(
    @CurrentUser() user: RequestUser,
    @Query("since") since?: string,
  ): Promise<CatalogSyncResponse> {
    // since 缺省 → 首次同步，全量在售商品；since 非法 → 视同缺省（容错）
    let sinceDate: Date | undefined;
    if (since) {
      const d = new Date(since);
      sinceDate = Number.isNaN(d.getTime()) ? undefined : d;
    }
    const res = await this.products.listProductsForSync(user.shopId, sinceDate);
    if (user.role === "staff") {
      return { ...res, products: res.products.map((p) => redactProductCost(p)) };
    }
    return res;
  }

  /** 新手一键体验：为空门店灌入演示商品（仅店主） */
  @Post("products/demo")
  @Roles("owner")
  seedDemo(@CurrentUser() user: RequestUser) {
    return this.products.seedDemo(user.shopId);
  }

  /**
   * 建档识图：只读本店已上传的本地 JPEG，转 base64 调视觉模型。
   * 必须写在 products/:id 之前，避免被参数路由吞掉。
   */
  @Post("products/recognize-garment")
  recognizeGarment(
    @Body(new ZodValidationPipe(RecognizeGarmentInput)) body: RecognizeGarmentInput,
  ) {
    return this.vision.recognize(body.imagePath);
  }

  /** 编辑商品（仅店主）：改名/改价/盘点改库存/改颜色尺码 */
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
  async findByBarcode(@CurrentUser() user: RequestUser, @Param("barcode") barcode: string) {
    const sku = await this.products.findByBarcode(user.shopId, barcode);
    return user.role === "staff" ? redactSkuCost(sku) : sku;
  }
}
