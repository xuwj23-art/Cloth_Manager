import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** APK 存放目录（生产用 docker 卷/绑定挂载持久化，见 docker-compose.prod.yml） */
export const DOWNLOAD_DIR = join(process.cwd(), "download");

/** 对外下载的固定文件名：多版本模式下 /download/app.apk 永远指向「当前生效版本」 */
export const APK_NAME = "app.apk";

/** 生效版本与更新说明的配置文件名（可选；不写则自动取版本号最高的包） */
export const CURRENT_JSON = "current.json";

if (!existsSync(DOWNLOAD_DIR)) {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
}
