import { Module } from "@nestjs/common";
import { SalesController } from "./sales.controller";
import { SalesCommandService } from "./sales-command.service";
import { SalesReportService } from "./sales-report.service";
import { ProductsModule } from "../products/products.module";

@Module({
  imports: [ProductsModule],
  controllers: [SalesController],
  providers: [SalesCommandService, SalesReportService],
})
export class SalesModule {}
