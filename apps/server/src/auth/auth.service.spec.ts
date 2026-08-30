import { describe, it, expect, beforeEach, vi } from "vitest";
import { JwtService } from "@nestjs/jwt";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";
import type { PrismaService } from "../prisma/prisma.service";

function makePrisma(overrides: Partial<Record<string, any>> = {}) {
  const tx = {
    shop: {
      create: vi.fn().mockResolvedValue({ id: "shop-1" }),
      findUnique: vi.fn().mockResolvedValue({ name: "测试店" }),
    },
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
    process.env.REGISTER_CODE = "test-code";
  });

  it("注册：创建门店+老板，返回 token 且密码被哈希", async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma, jwt);

    const res = await service.register({
      shopName: "测试店",
      name: "张三",
      phone: "13800000000",
      password: "123456",
      inviteCode: "test-code",
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
      service.register({
        shopName: "店",
        name: "李四",
        phone: "13800000001",
        password: "123456",
        inviteCode: "test-code",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("注册：邀请码错误抛 ForbiddenException", async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma, jwt);
    await expect(
      service.register({
        shopName: "店",
        name: "李四",
        phone: "13800000001",
        password: "123456",
        inviteCode: "wrong-code",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
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
    await expect(service.login({ phone: "13800000000", password: "wrong" })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
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

  describe("changePassword", () => {
    it("原密码正确：哈希更新为新密码", async () => {
      const passwordHash = await bcrypt.hash("123456", 10);
      const prisma = makePrisma({
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "u1", passwordHash }),
          update: vi.fn().mockResolvedValue({ id: "u1" }),
        },
      });
      const service = new AuthService(prisma, jwt);
      const res = await service.changePassword("u1", {
        oldPassword: "123456",
        newPassword: "abcdef",
      });
      expect(res).toEqual({ ok: true });
      const updateArg = (prisma.user.update as any).mock.calls[0][0];
      expect(await bcrypt.compare("abcdef", updateArg.data.passwordHash)).toBe(true);
    });

    it("原密码错误：抛 UnauthorizedException 且不更新", async () => {
      const passwordHash = await bcrypt.hash("123456", 10);
      const update = vi.fn();
      const prisma = makePrisma({
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "u1", passwordHash }),
          update,
        },
      });
      const service = new AuthService(prisma, jwt);
      await expect(
        service.changePassword("u1", {
          oldPassword: "wrong",
          newPassword: "abcdef",
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(update).not.toHaveBeenCalled();
    });

    it("新密码与原密码相同：抛 ConflictException", async () => {
      const passwordHash = await bcrypt.hash("123456", 10);
      const prisma = makePrisma({
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "u1", passwordHash }),
          update: vi.fn(),
        },
      });
      const service = new AuthService(prisma, jwt);
      await expect(
        service.changePassword("u1", {
          oldPassword: "123456",
          newPassword: "123456",
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("账号不存在（理论上仅被删用户）：抛 UnauthorizedException", async () => {
      const prisma = makePrisma({
        user: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
      });
      const service = new AuthService(prisma, jwt);
      await expect(
        service.changePassword("gone", {
          oldPassword: "123456",
          newPassword: "abcdef",
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("resetStaffPassword", () => {
    it("店主重置本店店员：哈希更新", async () => {
      const update = vi.fn().mockResolvedValue({ id: "u2" });
      const prisma = makePrisma({
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "u2", shopId: "shop-1", role: "staff" }),
          update,
        },
      });
      const service = new AuthService(prisma, jwt);
      const res = await service.resetStaffPassword("shop-1", "u2", {
        newPassword: "newpass",
      });
      expect(res).toEqual({ ok: true });
      const updateArg = update.mock.calls[0][0];
      expect(await bcrypt.compare("newpass", updateArg.data.passwordHash)).toBe(true);
    });

    it("目标是店主：抛 ForbiddenException（防越权重置老板）", async () => {
      const prisma = makePrisma({
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "u1", shopId: "shop-1", role: "owner" }),
          update: vi.fn(),
        },
      });
      const service = new AuthService(prisma, jwt);
      await expect(
        service.resetStaffPassword("shop-1", "u1", { newPassword: "newpass" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("跨店或不存在：抛 NotFoundException（不泄露存在性）", async () => {
      const prisma = makePrisma({
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "u9", shopId: "shop-2", role: "staff" }),
          update: vi.fn(),
        },
      });
      const service = new AuthService(prisma, jwt);
      await expect(
        service.resetStaffPassword("shop-1", "u9", { newPassword: "newpass" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("updateMyName", () => {
    it("改名成功：写库并返回含新名字的用户信息", async () => {
      const update = vi.fn().mockImplementation(({ data }: any) => ({
        id: "u1",
        shopId: "shop-1",
        name: data.name,
        phone: "13800000000",
        passwordHash: "x",
        role: "staff",
      }));
      const prisma = makePrisma({
        user: { findUnique: vi.fn(), update },
        shop: { findUnique: vi.fn().mockResolvedValue({ name: "测试店" }) },
      });
      const service = new AuthService(prisma, jwt);
      const res = await service.updateMyName("u1", { name: "新名字" });
      expect(update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { name: "新名字" } });
      expect(res.name).toBe("新名字");
      expect(res.shopName).toBe("测试店");
    });

    it("用户不存在（已被删）：抛 UnauthorizedException", async () => {
      const update = vi.fn().mockImplementation(() => {
        throw Object.assign(new Error("not found"), { code: "P2025" });
      });
      const prisma = makePrisma({ user: { findUnique: vi.fn(), update } });
      const service = new AuthService(prisma, jwt);
      await expect(service.updateMyName("gone", { name: "x" })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe("updateShopName", () => {
    it("店主改店名：shop 写库并返回刷新后的用户信息（新 shopName）", async () => {
      const shopUpdate = vi.fn().mockResolvedValue({ id: "shop-1", name: "新店名" });
      const prisma = makePrisma({
        user: {
          findFirst: vi
            .fn()
            .mockResolvedValue({
              id: "u1",
              shopId: "shop-1",
              role: "owner",
              name: "张三",
              phone: "13800000000",
              passwordHash: "x",
            }),
        },
        shop: { findUnique: vi.fn().mockResolvedValue({ name: "新店名" }), update: shopUpdate },
      });
      const service = new AuthService(prisma, jwt);
      const res = await service.updateShopName("shop-1", { shopName: "新店名" });
      expect(shopUpdate).toHaveBeenCalledWith({
        where: { id: "shop-1" },
        data: { name: "新店名" },
      });
      expect(res.shopName).toBe("新店名");
    });

    it("门店不存在：抛 NotFoundException", async () => {
      const prisma = makePrisma({
        user: {
          findFirst: vi.fn().mockResolvedValue({ id: "u1", shopId: "shop-x", role: "owner" }),
        },
        shop: {
          findUnique: vi.fn().mockResolvedValue({ name: "旧名" }),
          update: vi.fn().mockImplementation(() => {
            throw Object.assign(new Error("not found"), { code: "P2025" });
          }),
        },
      });
      const service = new AuthService(prisma, jwt);
      await expect(service.updateShopName("shop-x", { shopName: "y" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
