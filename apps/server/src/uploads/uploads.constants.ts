import { join } from "node:path";

/**
 * 图片上传目录（绝对路径）。开发期用本地磁盘存储；
 * 生产应替换为对象存储（阿里云 OSS / 腾讯云 COS / 七牛 / R2）。
 */
export const UPLOADS_DIR = join(process.cwd(), "uploads");
