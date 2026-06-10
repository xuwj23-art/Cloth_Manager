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
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { UPLOADS_DIR } from "./uploads.constants";

/** 主图最长边（px）。手机直拍约 3000~4000px，压到 1280 足够清晰且体积小 */
const MAIN_MAX = 1280;
/** 缩略图最长边（px），用于列表/卡片，省流量、加载快 */
const THUMB_MAX = 320;

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
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("未收到文件");

    // 统一压缩：主图(JPEG q72) + 缩略图(JPEG q70)，去 EXIF、自动转正。
    // 2 万件每件一张时，原始可能十几 G；压缩后约 100~200KB/张，整体仅几个 G。
    const orig = join(UPLOADS_DIR, file.filename);
    const base = file.filename.replace(/\.[^.]+$/, "");
    const mainName = `${base}.jpg`;
    const thumbName = `${base}.thumb.jpg`;

    try {
      const mainBuf = await sharp(orig)
        .rotate()
        .resize(MAIN_MAX, MAIN_MAX, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 72 })
        .toBuffer();
      await writeFile(join(UPLOADS_DIR, mainName), mainBuf);

      const thumbBuf = await sharp(orig)
        .rotate()
        .resize(THUMB_MAX, THUMB_MAX, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
      await writeFile(join(UPLOADS_DIR, thumbName), thumbBuf);

      // 删除原始未压缩文件（扩展名不同才需删，避免删掉刚写入的 .jpg）
      if (mainName !== file.filename) {
        await unlink(orig).catch(() => undefined);
      }
    } catch {
      // 压缩失败兜底：保留原图，仍返回可用 url
      return { url: `/uploads/${file.filename}` };
    }

    // 返回主图相对路径；缩略图为同名 .thumb.jpg，前端按约定推导。
    return { url: `/uploads/${mainName}` };
  }
}
