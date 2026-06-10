import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "node:path";
import { API_PREFIX } from "@cloth-scan/shared";
import { AppModule } from "./app.module";
import { UPLOADS_DIR } from "./uploads/uploads.constants";

async function bootstrap() {
  // 请求体校验统一用共享包的 Zod（见 ZodValidationPipe），不依赖 class-validator。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
  });
  // download 页要做对外公开链接，排除在 /api/v1 前缀外（变成 /download）
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ""), {
    exclude: ["download", "download/app.apk"],
  });

  // 上传的图片以静态资源对外提供：/uploads/<filename>
  app.useStaticAssets(UPLOADS_DIR, { prefix: "/uploads/" });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  Logger.log(`服务已启动: http://localhost:${port}${API_PREFIX}`, "Bootstrap");
}

void bootstrap();
