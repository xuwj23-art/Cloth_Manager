-- AlterTable: 给销售明细增加「进价快照」列，用于计算历史利润（改进价不影响过往）
ALTER TABLE "SaleItem" ADD COLUMN "cost" INTEGER NOT NULL DEFAULT 0;
