import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { createReadStream } from "node:fs";
import * as QRCode from "qrcode";
import { APK_NAME } from "./download.constants";
import { DownloadApkService } from "./download-apk.service";
import { renderDownloadPage, type DownloadPageVersion } from "./download-page.template";

/**
 * APK 对外下载页（公开访问，不在 /api/v1 前缀下，见 main.ts 的 exclude）。
 * - GET /download                版本列表页：生效版本大按钮 + 全部历史版本可选下载
 * - GET /download/app.apk        下载「当前生效版本」（固定链接，二维码/书签永远指向它）
 * - GET /download/apk/:file      下载指定版本（文件名白名单校验，防路径穿越）
 *
 * 版本发现与生效规则见 DownloadApkService（文件驱动 + current.json，无数据库）。
 */
@Controller("download")
export class DownloadController {
  constructor(private readonly apks: DownloadApkService) {}

  @Get()
  async page(@Req() req: Request, @Res() res: Response): Promise<void> {
    const base = `${req.protocol}://${req.get("host")}`;
    const versions = this.apks.listVersions();
    const activeFile = this.apks.resolveActive()?.file ?? "";

    const rows: DownloadPageVersion[] = versions.map((v) => ({
      file: v.file,
      version: v.version ?? "未标注版本",
      sizeMB: (v.sizeBytes / 1024 / 1024).toFixed(1),
      updated: new Date(v.mtimeMs).toLocaleString("zh-CN", { hour12: false }),
      note: v.note,
      isActive: v.file === activeFile,
    }));

    const qr =
      versions.length > 0
        ? await QRCode.toDataURL(`${base}/download`, { width: 320, margin: 1 })
        : "";

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(renderDownloadPage({ versions: rows, qr }));
  }

  /** 固定链接：永远返回当前生效版本（兼容旧二维码与已分发的链接） */
  @Get(APK_NAME)
  apk(@Res() res: Response): void {
    const active = this.apks.resolveActive();
    if (!active) {
      res.status(404).send("APK 尚未上传");
      return;
    }
    this.streamApk(res, active.file);
  }

  /** 指定版本下载（文件名经白名单校验，非法直接 404） */
  @Get("apk/:file")
  apkFile(@Param("file") file: string, @Res() res: Response): void {
    this.streamApk(res, file);
  }

  /**
   * 应用内更新检查（公开 JSON）：当前生效版本的元数据。
   * App 端与本地 version 比较决定 OTA / APK 更新路径；version 为 null（裸 app.apk 旧包）
   * 时 App 应忽略 APK 通道、仅走 OTA。
   */
  @Get("manifest")
  manifest(@Req() req: Request) {
    const active = this.apks.resolveActive();
    const base = `${req.protocol}://${req.get("host")}`;
    if (!active) {
      return { version: null as string | null, file: "", sizeBytes: 0, note: "", url: "" };
    }
    return {
      version: active.version,
      file: active.file,
      sizeBytes: active.sizeBytes,
      note: active.note,
      url: `${base}/download/apk/${active.file}`,
    };
  }

  /** 流式发送 APK（几乎不占内存）；文件不存在时 404 */
  private streamApk(res: Response, file: string): void {
    const s = this.apks.statFile(file);
    if (!s) {
      res.status(404).send("版本不存在");
      return;
    }
    res.set({
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(s.size),
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-cache",
    });
    createReadStream(s.path).pipe(res);
  }
}
