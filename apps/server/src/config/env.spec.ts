import { describe, it, expect } from "vitest";
import { loadEnv } from "./env";

/**
 * env.ts 单测：loadEnv 接受显式 env 对象，不依赖 process.env，无副作用。
 * 覆盖：合法解析 + 各字段缺失/格式错的 fail-fast。
 */
describe("config/env loadEnv", () => {
  const VALID = {
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    JWT_SECRET: "x".repeat(32),
  };

  it("合法 env：返回解析后对象，PORT 数字化、NODE_ENV 默认 development", () => {
    const env = loadEnv({ ...VALID, PORT: "3001" });
    expect(env.DATABASE_URL).toBe(VALID.DATABASE_URL);
    expect(env.JWT_SECRET).toHaveLength(32);
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe("development");
    expect(env.REGISTER_CODE).toBeUndefined();
  });

  it("缺失 DATABASE_URL：抛错且信息含字段名", () => {
    expect(() => loadEnv({ JWT_SECRET: "x".repeat(32) })).toThrow(/DATABASE_URL/);
  });

  it("JWT_SECRET 不足 32 字符：抛错", () => {
    expect(() => loadEnv({ ...VALID, JWT_SECRET: "short" })).toThrow(/JWT_SECRET.*32/);
  });

  it("DATABASE_URL 非 postgres 协议：抛错", () => {
    expect(() => loadEnv({ ...VALID, DATABASE_URL: "mysql://u:p@localhost:3306/db" })).toThrow(
      /postgresql/,
    );
  });

  it("PORT 非法（0 或越界）：抛错", () => {
    expect(() => loadEnv({ ...VALID, PORT: "0" })).toThrow(/PORT/);
    expect(() => loadEnv({ ...VALID, PORT: "99999" })).toThrow(/PORT/);
  });

  it("PORT 缺省默认 3000", () => {
    expect(loadEnv({ ...VALID }).PORT).toBe(3000);
  });

  it("REGISTER_CODE 可选：提供时返回", () => {
    expect(loadEnv({ ...VALID, REGISTER_CODE: "invite-xyz" }).REGISTER_CODE).toBe("invite-xyz");
  });

  it("合并错误：多个字段同时错时一次列出（fail-fast 单次抛错）", () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL[\s\S]*JWT_SECRET/);
  });
});
