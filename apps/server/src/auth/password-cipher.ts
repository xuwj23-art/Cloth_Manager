import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * 「查看我的密码」功能的可逆密码记录（店员设置页眼睛图标）。
 *
 * 背景：passwordHash 是 bcrypt 单向哈希，无法回显明文。店主要求店员可自助查看
 * 密码（省得忘了问老板），故在设置/重置密码时**额外**存一份 AES-256-GCM 加密副本
 * （passwordCipher，可空）。存量旧密码没有副本，只能由店主重置一次后才有记录。
 *
 * 密钥：环境变量 PASSWORD_CIPHER_KEY（64 位 hex = 32 字节）。未配置时该功能整体
 * 降级（不写副本、查询返回 null），不影响登录与改密主流程。
 *
 * 安全代价（已向店主披露）：token 泄露即可查看本人明文密码；密钥与数据库同机部署。
 * 这是有意为小店便利做的取舍，勿扩散到他人密码查询。
 */

/** 惰性读取密钥（测试会中途改 env；运行时也允许容器注入晚于模块加载） */
function keyHex(): string {
  return process.env.PASSWORD_CIPHER_KEY ?? "";
}

export function passwordCipherEnabled(): boolean {
  return /^[0-9a-f]{64}$/.test(keyHex());
}

/** 加密明文密码，返回 "iv.tag.ciphertext"（hex）；未配置密钥返回 null（不写副本） */
export function encryptPassword(plain: string): string | null {
  if (!passwordCipherEnabled()) return null;
  const key = keyHex();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(".");
}

/** 解密密码副本；无副本/密钥缺失/数据损坏一律返回 null（查询端显示「无记录」） */
export function decryptPassword(stored: string | null | undefined): string | null {
  if (!stored || !passwordCipherEnabled()) return null;
  const parts = stored.split(".");
  if (parts.length !== 3) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(keyHex(), "hex"),
      Buffer.from(parts[0]!, "hex"),
    );
    decipher.setAuthTag(Buffer.from(parts[1]!, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[2]!, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
