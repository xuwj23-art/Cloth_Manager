import { describe, it, expect, beforeEach, vi } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { UnauthorizedException, ConflictException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";
import type { PrismaService } from "../prisma/prisma.service";

function makePrisma(overrides: Partial<Record<string, any>> = {}) {
  const tx = {
    shop: { create: vi.fn().mockResolvedValue({ id: "shop-1" }) },
    user: {
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: "user-1",
        shopId: data.shopId,
        name: data.name,
        phone: data.phone,
        passwordHash: data.passwordHash,
        role: data.role,
      })),
    },
  };
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: tx.user.create,
    },
    shop: tx.shop,
    $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    ...overrides,
  };
  return prisma as unknown as PrismaService;
}

describe("AuthService", () => {
  let jwt: JwtService;

  beforeEach(() => {
    jwt = new JwtService({ secret: "test-secret", signOptions: { expiresIn: "1h" } });
  });

  it("注册：创建门店+老板，返回 token 且密码被哈希", async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma, jwt);

    const res = await service.register({
      shopName: "测试店",
      name: "张三",
      phone: "13800000000",
      password: "123456",
    });

    expect(res.token).toBeTruthy();
    expect(res.user.role).toBe("owner");
    // 校验写库时密码确实被哈希（非明文）
    const createArg = (prisma.user.create as any).mock.calls[0][0];
    expect(createArg.data.passwordHash).not.toBe("123456");
    expect(await bcrypt.compare("123456", createArg.data.passwordHash)).toBe(true);
  });

  it("注册：手机号已存在则抛 ConflictException", async () => {
    const prisma = makePrisma({
      user: { findUnique: vi.fn().mockResolvedValue({ id: "x" }), create: vi.fn() },
    });
    const service = new AuthService(prisma, jwt);
    await expect(
      service.register({ shopName: "店", name: "李四", phone: "13800000001", password: "123456" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("登录：密码正确返回 token", async () => {
    const passwordHash = await bcrypt.hash("123456", 10);
    const prisma = makePrisma({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          shopId: "shop-1",
          name: "张三",
          phone: "13800000000",
          passwordHash,
          role: "owner",
        }),
      },
    });
    const service = new AuthService(prisma, jwt);
    const res = await service.login({ phone: "13800000000", password: "123456" });
    expect(res.token).toBeTruthy();
    expect(res.user.id).toBe("user-1");
  });

  it("登录：密码错误抛 UnauthorizedException", async () => {
    const passwordHash = await bcrypt.hash("correct", 10);
    const prisma = makePrisma({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          shopId: "shop-1",
          name: "张三",
          phone: "13800000000",
          passwordHash,
          role: "owner",
        }),
      },
    });
    const service = new AuthService(prisma, jwt);
    await expect(
      service.login({ phone: "13800000000", password: "wrong" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("createStaff：在本门店下创建 staff 角色账号", async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma, jwt);
    const res = await service.createStaff("shop-1", {
      name: "小王",
      phone: "13800000002",
      password: "123456",
    });
    expect(res.user.role).toBe("staff");
    expect(res.user.shopId).toBe("shop-1");
  });

  it("listMembers：返回本门店成员且不含密码", async () => {
    const prisma = makePrisma({
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "u1",
            name: "老板",
            phone: "13800000000",
            role: "owner",
            passwordHash: "secret",
            createdAt: new Date("2026-06-01T00:00:00.000Z"),
          },
          {
            id: "u2",
            name: "小王",
            phone: "13800000002",
            role: "staff",
            passwordHash: "secret",
            createdAt: new Date("2026-06-02T00:00:00.000Z"),
          },
        ]),
      },
    });
    const service = new AuthService(prisma, jwt);
    const members = await service.listMembers("shop-1");
    expect(members).toHaveLength(2);
    expect(members[0]).not.toHaveProperty("passwordHash");
    expect(members[1]).toMatchObject({ name: "小王", role: "staff" });
  });
});
