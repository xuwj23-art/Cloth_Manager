import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { startPg, stopPg, resetDb } from "../../test/pg-container";

describe("PG 容器集成测试基础设施", () => {
  let prisma: PrismaClient;
  beforeAll(async () => { prisma = await startPg(); });
  afterAll(async () => { await stopPg(); });

  it("容器已启动且能建表（SELECT 1 成功）", async () => {
    const r = await prisma.$queryRaw`SELECT 1 AS ok`;
    expect((r as any)[0].ok).toBe(1);
  });

  it("能创建测试数据并清理", async () => {
    await resetDb(prisma);
    const shop = await prisma.shop.create({ data: { name: "测试店" } });
    expect(shop.id).toBeDefined();
    await resetDb(prisma);
    const count = await prisma.shop.count();
    expect(count).toBe(0);
  });
});
