import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_PHONE = "13800000000";
const DEMO_PASSWORD = "123456";

async function main() {
  const shop = await prisma.shop.create({ data: { name: "示例门店" } });

  await prisma.user.create({
    data: {
      shopId: shop.id,
      name: "老板",
      phone: DEMO_PHONE,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      role: "owner",
    },
  });

  const product = await prisma.product.create({
    data: {
      shopId: shop.id,
      name: "纯棉圆领T恤",
      skus: {
        create: [
          { color: "白", size: "M", barcode: "DEMO-WHITE-M", salePrice: 5900, costPrice: 2500, stock: 10 },
          { color: "白", size: "L", barcode: "DEMO-WHITE-L", salePrice: 5900, costPrice: 2500, stock: 8 },
          { color: "黑", size: "M", barcode: "DEMO-BLACK-M", salePrice: 5900, costPrice: 2500, stock: 5 },
        ],
      },
    },
    include: { skus: true },
  });

  for (const sku of product.skus) {
    await prisma.stockMovement.create({
      data: { skuId: sku.id, type: "in", quantity: sku.stock, opId: randomUUID() },
    });
  }

  console.log("种子数据完成：");
  console.log("  门店ID:", shop.id);
  console.log(`  登录账号: ${DEMO_PHONE} / 密码: ${DEMO_PASSWORD}`);
  console.log("  示例条码:", product.skus.map((s) => s.barcode).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
