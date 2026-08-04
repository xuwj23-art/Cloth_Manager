import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as QRCode from "qrcode";
import { APK_NAME, DOWNLOAD_DIR } from "./download.constants";
import { renderDownloadPage } from "./download-page.template";

/**
 * APK 对外下载页（公开访问，不在 /api/v1 前缀下，见 main.ts 的 exclude）。
 * - GET /download           带二维码 + 下载按钮 + 安装说明的网页
 * - GET /download/app.apk   直接下载 APK（流式发送，几乎不占内存）
 *
 * APK 文件放在 DOWNLOAD_DIR/app.apk，覆盖式更新；可选 version.txt 写版本号。
 *
 * E7：HTML 模板抽到 download-page.template.ts，本 controller 只负责
 * 收集请求时数据（文件大小/版本/QR）→ 交给模板渲染 → 以 text/html 返回。
 */
@Controller("download")
export class DownloadController {
  @Get()
  async page(@Req() req: Request, @Res() res: Response): Promise<void> {
    const apkPath = join(DOWNLOAD_DIR, APK_NAME);
    const exists = existsSync(apkPath);
    const base = `${req.protocol}://${req.get("host")}`;
    const pageUrl = `${base}/download`;

    let sizeMB = "";
    let updated = "";
    if (exists) {
      const st = statSync(apkPath);
      sizeMB = (st.size / 1024 / 1024).toFixed(1);
      updated = new Date(st.mtime).toLocaleString("zh-CN", { hour12: false });
    }

    let version = "";
    const verPath = join(DOWNLOAD_DIR, "version.txt");
    if (existsSync(verPath)) version = readFileSync(verPath, "utf8").trim();

    const qr = exists ? await QRCode.toDataURL(pageUrl, { width: 320, margin: 1 }) : "";

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(renderDownloadPage({ exists, sizeMB, updated, version, qr }));
  }

  @Get(APK_NAME)
  apk(@Res() res: Response): void {
    const apkPath = join(DOWNLOAD_DIR, APK_NAME);
    if (!existsSync(apkPath)) {
      res.status(404).send("APK 尚未上传");
      return;
    }
    const st = statSync(apkPath);
    res.set({
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(st.size),
      "Content-Disposition": `attachment; filename="cloth-scan.apk"`,
      "Cache-Control": "no-cache",
    });
    createReadStream(apkPath).pipe(res);
  }
}
