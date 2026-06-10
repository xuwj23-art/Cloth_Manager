-- AlterTable: 商品软删除时间（null=未删除）。删除时清理图片释放磁盘，保留行以维持销售历史外键。
ALTER TABLE "Product" ADD COLUMN "deletedAt" TIMESTAMP(3);
