import { z } from "zod";

/**
 * 启动期环境变量校验（E7：fail-fast）。
 *
 * 背景：
 *  - 之前 DATABASE_URL/JWT_SECRET 等只在被用到时才隐式失败（运行时迟到错误），
 *    配错环境变量的服务可能起来半天才在第一个请求/第一次签 JWT 时崩。
 *  - 本模块在 main.ts 的 NestFactory.create 之前同步执行 Zod 校验，
 *    配错立即抛错并打印缺失字段，避免带着错误配置半启动。
 *
 * 与 auth.module.ts 内 JWT_SECRET 校验的关系：
 *  - 那里是 JwtModule 注册时的二次防线（防御性），保留不动；
 *  - 本模块是统一入口，把 DATABASE_URL/PORT/REGISTER_CODE/JWT_SECRET 一起校验。
 *
 * 用法：main.ts 顶部 `import "./config/env";`（副作用模块，加载即校验）。
 * 同时 export parsed Env 供需要类型安全读取的代码使用。
 */

const envSchema = z.object({
  /** PostgreSQL 连接串（必填，无默认）。形如 postgresql://user:pass@host:port/db?schema=public */
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL 必须配置（PostgreSQL 连接串）")
    .startsWith("postgres", "DATABASE_URL 必须是 postgresql:// 连接串"),

  /**
   * JWT 签名密钥（必填，长度 ≥ 32 字符）。
   * 长度要求覆盖 HS256 安全基线（256-bit ≈ 32 字节）。
   * 生产请用 `openssl rand -hex 32` 生成随机长串。
   */
  JWT_SECRET: z.string().min(32, "JWT_SECRET 必须配置且长度 ≥ 32 字符（生产安全要求）"),

  /** 注册邀请码（可选；不设 = 关闭注册）。 */
  REGISTER_CODE: z.string().optional(),

  /** 服务监听端口（可选，默认 3000）。 */
  PORT: z
    .string()
    .optional()
    .default("3000")
    .transform((v) => Number.parseInt(v, 10))
    .refine((n) => Number.isInteger(n) && n > 0 && n < 65536, "PORT 必须是 1-65535 的整数"),

  /** Node 环境（可选，仅信息性，不强制取值集合）。 */
  NODE_ENV: z.enum(["development", "production", "test"]).optional().default("development"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * 解析 process.env 并返回类型安全的 Env 对象。
 * 失败时直接抛错（含全部字段的合并错误信息），由调用方/进程退出承载。
 *
 * 不做缓存——单测需反复用不同 env 调用；生产侧 main.ts 也只调一次。
 */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`环境变量校验失败：\n${issues}\n请检查 .env 配置后重启服务。`);
  }
  return result.data;
}

/**
 * 调用契约：main.ts 顶部 `import { loadEnv } from "./config/env"; loadEnv();`
 * 在所有其他 import 之前同步执行，失败即抛错，进程在 NestFactory.create 之前退出。
 * 不做模块加载时副作用，便于单测隔离 process.env 反复调用。
 */
