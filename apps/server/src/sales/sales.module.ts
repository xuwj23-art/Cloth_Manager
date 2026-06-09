import { Module } from "@nestjs/common";
import { SalesController } from "./sales.controller";
import { SalesService } from "./sales.service";
import { ProductsModule } from "../products/products.module";

@Module({
  imports: [ProductsModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
