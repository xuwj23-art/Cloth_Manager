import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { API_PREFIX } from "@cloth-scan/shared";
// E7：用 Zod 校验 process.env——任何必填变量缺失/格式错都会在
// NestFactory.create 之前抛错（fail-fast）。在所有其他 import 之前执行，
// 避免带着错误配置半启动（如 PrismaClient 拿到空 DATABASE_URL）。
import { loadEnv } from "./config/env";
loadEnv();
import { AppModule } from "./app.module";
import { UPLOADS_DIR } from "./uploads/uploads.constants";

async function bootstrap() {
  // 请求体校验统一用共享包的 Zod（见 ZodValidationPipe），不依赖 class-validator。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
  });
  // download 页要做对外公开链接，排除在 /api/v1 前缀外（变成 /download、
  // /download/app.apk、/download/apk/<版本文件名>、/download/manifest 应用内更新检查）
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ""), {
    exclude: ["download", "download/app.apk", "download/apk/:file", "download/manifest"],
  });

  // 上传的图片以静态资源对外提供：/uploads/<filename>
  app.useStaticAssets(UPLOADS_DIR, { prefix: "/uploads/" });

  const { PORT } = loadEnv();
  const port = PORT;
  await app.listen(port);
  Logger.log(`服务已启动: http://localhost:${port}${API_PREFIX}`, "Bootstrap");
}

void bootstrap();
