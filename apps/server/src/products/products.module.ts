import { Module } from "@nestjs/common";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { GarmentVisionService } from "./garment-vision.service";

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, GarmentVisionService],
  exports: [ProductsService],
})
export class ProductsModule {}
