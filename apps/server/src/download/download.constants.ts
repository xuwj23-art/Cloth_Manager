import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** APK 存放目录（生产用 docker 卷/绑定挂载持久化，见 docker-compose.prod.yml） */
export const DOWNLOAD_DIR = join(process.cwd(), "download");

/** 对外下载的固定文件名（覆盖式更新，永远只保留最新一个） */
export const APK_NAME = "app.apk";

if (!existsSync(DOWNLOAD_DIR)) {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
}
