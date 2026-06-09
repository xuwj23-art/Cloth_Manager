import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { UPLOADS_DIR } from "./uploads.constants";

if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

@Controller("uploads")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UploadsController {
  /** 图片上传仅店主使用（用于建档） */
  @Post()
  @Roles("owner")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase() || ".jpg";
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED.includes(ext)) {
          return cb(new BadRequestException("仅支持图片文件"), false);
        }
        cb(null, true);
      },
    }),
  )
  upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("未收到文件");
    // 返回相对路径；前端展示时按需拼接服务器地址。
    return { url: `/uploads/${file.filename}` };
  }
}
