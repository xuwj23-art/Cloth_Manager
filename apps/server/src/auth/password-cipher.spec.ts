import { describe, it, expect, afterEach } from "vitest";
import { decryptPassword, encryptPassword, passwordCipherEnabled } from "./password-cipher";

describe("password-cipher", () => {
  const origKey = process.env.PASSWORD_CIPHER_KEY;

  afterEach(() => {
    process.env.PASSWORD_CIPHER_KEY = origKey;
  });

  it("未配置密钥：整体降级（不加密、查询为 null）", () => {
    delete process.env.PASSWORD_CIPHER_KEY;
    expect(passwordCipherEnabled()).toBe(false);
    expect(encryptPassword("123456")).toBeNull();
    expect(decryptPassword("whatever")).toBeNull();
  });

  it("配置合法密钥：加密→解密 roundtrip 还原明文", () => {
    process.env.PASSWORD_CIPHER_KEY =
      "9f3c1a5e7b2d4f6a8c0e2b4d6f8a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a";
    expect(passwordCipherEnabled()).toBe(true);
    const stored = encryptPassword("shopSecret123");
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("shopSecret123");
    expect(decryptPassword(stored)).toBe("shopSecret123");
  });

  it("同明文两次加密产生不同密文（随机 IV），但均可解密", () => {
    process.env.PASSWORD_CIPHER_KEY =
      "9f3c1a5e7b2d4f6a8c0e2b4d6f8a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a";
    const a = encryptPassword("same");
    const b = encryptPassword("same");
    expect(a).not.toBe(b);
    expect(decryptPassword(a)).toBe("same");
    expect(decryptPassword(b)).toBe("same");
  });

  it("密文被篡改（GCM 校验失败）或格式损坏：返回 null 而非抛错", () => {
    process.env.PASSWORD_CIPHER_KEY =
      "9f3c1a5e7b2d4f6a8c0e2b4d6f8a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a";
    const stored = encryptPassword("abc123")!;
    const tampered = stored.slice(0, -4) + "0000";
    expect(decryptPassword(tampered)).toBeNull();
    expect(decryptPassword("not-a-valid-format")).toBeNull();
    expect(decryptPassword(null)).toBeNull();
  });
});
