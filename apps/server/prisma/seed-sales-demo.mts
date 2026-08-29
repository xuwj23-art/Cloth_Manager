/**
 * 临时演示数据（仅本地库）：造两个月、双员工的销售订单，用于销售统计界面验收。
 * 幂等：先清掉本脚本此前造的演示单（clientNote 无字段，按 opId 前缀 demo-seed- 删）。
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const shop = await prisma.shop.findFirst({ where: { name: "示例门店" } });
  if (!shop) throw new Error("示例门店不存在，请先跑 db:seed");
  const owner = await prisma.user.findFirst({ where: { shopId: shop.id, role: "owner" } });
  if (!owner) throw new Error("没有老板账号");

  // 店员 小王 / 小张
  let staff1 = await prisma.user.findFirst({ where: { shopId: shop.id, phone: "13900000001" } });
  if (!staff1) {
    staff1 = await prisma.user.create({
      data: { shopId: shop.id, phone: "13900000001", name: "小王", role: "staff", passwordHash: bcrypt.hashSync("123456", 10) },
    });
  }
  let staff2 = await prisma.user.findFirst({ where: { shopId: shop.id, phone: "13900000002" } });
  if (!staff2) {
    staff2 = await prisma.user.create({
      data: { shopId: shop.id, phone: "13900000002", name: "小张", role: "staff", passwordHash: bcrypt.hashSync("123456", 10) },
    });
  }

  // 清旧演示单
  await prisma.saleOrder.deleteMany({ where: { shopId: shop.id, opId: { startsWith: "demo-seed-" } } });

  const skus = await prisma.sku.findMany({ where: { product: { shopId: shop.id } }, take: 3 });
  if (skus.length === 0) throw new Error("没有演示 SKU");

  const operators = [owner, staff1, staff2];
  let seq = 0;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); // 上月 1 号
  const end = now;

  for (let day = new Date(start); day <= end; day = new Date(day.getTime() + 86400000)) {
    // 周一少卖、周末多卖，营造趋势
    const dow = day.getUTCDay();
    const base = dow === 0 || dow === 6 ? 5 : dow === 1 ? 1 : 3;
    const count = base + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const op = operators[Math.floor(Math.random() * operators.length)]!;
      const hour = 9 + Math.floor(Math.random() * 11); // 9-20 点（北京时间）
      const createdAt = new Date(day.getTime() + (hour - 8) * 3600000 + Math.floor(Math.random() * 3600000));
      if (createdAt > end) continue;
      // 1-3 行明细
      const lineCount = 1 + Math.floor(Math.random() * 3);
      const items: { skuId: string; quantity: number; price: number; cost: number; subtotal: number }[] = [];
      let total = 0;
      for (let l = 0; l < lineCount; l++) {
        const sku = skus[Math.floor(Math.random() * skus.length)]!;
        const qty = 1 + Math.floor(Math.random() * 3);
        const price = sku.salePrice;
        const cost = Math.round(sku.costPrice * 0.9);
        items.push({ skuId: sku.id, quantity: qty, price, cost, subtotal: price * qty });
        total += price * qty;
      }
      await prisma.saleOrder.create({
        data: {
          shopId: shop.id,
          operatorId: op.id,
          status: "completed",
          totalAmount: total,
          orderDiscountCents: 0,
          opId: `demo-seed-${++seq}`,
          createdAt,
          items: { create: items },
        },
      });
    }
  }
  console.log(`seeded ${seq} demo orders`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
