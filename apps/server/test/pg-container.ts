import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";

let container: StartedPostgreSqlContainer | null = null;
let prisma: PrismaClient | null = null;

/**
 * 启动一次性 PG 容器并跑迁移，返回已建表的 PrismaClient。
 * 同一进程内复用（启动慢，约 1-2 秒）；测试套件结束由 afterAll 销毁。
 */
export async function startPg(): Promise<PrismaClient> {
  if (prisma) return prisma;
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("cloth_test")
    .start();
  const url = container.getConnectionUri();
  // 用容器的 DATABASE_URL 跑迁移（deploy 幂等）
  // 注：原计划用 `pnpm --filter @cloth-scan/server prisma migrate deploy`，
  // 但 pnpm 会把 prisma 当成 script 名而报 ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT，
  // 改用 `pnpm exec prisma`（vitest 工作目录已是 apps/server）。
  execSync(`pnpm exec prisma migrate deploy`, {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
  prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
  return prisma;
}

export async function stopPg(): Promise<void> {
  if (prisma) { await prisma.$disconnect(); prisma = null; }
  if (container) { await container.stop(); container = null; }
}

/** 清空所有业务表（每条测试前调用，保证隔离） */
export async function resetDb(p: PrismaClient): Promise<void> {
  const tables = ["stockMovement", "saleItem", "saleOrder", "sku", "product", "category", "user", "shop"];
  for (const t of tables) {
    // @ts-expect-error 动态表名
    await p[t].deleteMany({});
  }
}
