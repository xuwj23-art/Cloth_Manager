import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as QRCode from "qrcode";
import { APK_NAME, DOWNLOAD_DIR } from "./download.constants";

/**
 * APK 对外下载页（公开访问，不在 /api/v1 前缀下，见 main.ts 的 exclude）。
 * - GET /download           带二维码 + 下载按钮 + 安装说明的网页
 * - GET /download/app.apk   直接下载 APK（流式发送，几乎不占内存）
 *
 * APK 文件放在 DOWNLOAD_DIR/app.apk，覆盖式更新；可选 version.txt 写版本号。
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

    const qr = exists
      ? await QRCode.toDataURL(pageUrl, { width: 320, margin: 1 })
      : "";

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(renderPage({ exists, sizeMB, updated, version, qr }));
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

function renderPage(d: {
  exists: boolean;
  sizeMB: string;
  updated: string;
  version: string;
  qr: string;
}): string {
  const meta = [
    d.version ? `版本 ${d.version}` : "",
    d.sizeMB ? `${d.sizeMB} MB` : "",
    d.updated ? `更新于 ${d.updated}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const body = d.exists
    ? `
      <a class="btn" href="/download/${APK_NAME}">下载安装包（APK）</a>
      ${meta ? `<p class="meta">${meta}</p>` : ""}
      ${
        d.qr
          ? `<div class="qrbox"><img class="qr" src="${d.qr}" alt="二维码" /><p class="qrtip">手机扫码打开此页面</p></div>`
          : ""
      }
      <div class="tips">
        <h3>安装步骤</h3>
        <ol>
          <li>用<b>手机浏览器</b>打开本页面，点上方按钮下载。</li>
          <li>下载完成后点开安装；若提示「未知来源」，按提示<b>允许安装</b>即可。</li>
          <li>从旧版（云端版）换装本版本，需先卸载旧 App 再安装。</li>
        </ol>
      </div>`
    : `<p class="meta">安装包尚未上传，请稍后再来。</p>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<title>服装进销存 · 下载安装</title>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    background: linear-gradient(160deg, #2563eb 0%, #1e40af 100%);
    color: #111; padding: 24px;
  }
  .card {
    width: 100%; max-width: 420px; background: #fff; border-radius: 20px;
    padding: 28px 24px 24px; box-shadow: 0 20px 50px rgba(0,0,0,.25); text-align: center;
  }
  .logo { width: 64px; height: 64px; border-radius: 16px; background: #2563eb; margin: 0 auto 14px;
    display: flex; align-items: center; justify-content: center; font-size: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #6b7280; font-size: 13px; margin: 0 0 22px; }
  .btn {
    display: block; background: #2563eb; color: #fff; text-decoration: none; font-size: 17px;
    font-weight: 700; padding: 15px; border-radius: 12px; margin: 0 0 10px;
  }
  .btn:active { background: #1d4ed8; }
  .meta { color: #9ca3af; font-size: 12px; margin: 0 0 18px; }
  .qrbox { margin: 6px 0 20px; }
  .qr { width: 180px; height: 180px; border: 1px solid #eee; border-radius: 12px; padding: 8px; }
  .qrtip { color: #9ca3af; font-size: 12px; margin: 8px 0 0; }
  .tips { text-align: left; background: #f8fafc; border-radius: 12px; padding: 14px 16px; }
  .tips h3 { font-size: 14px; margin: 0 0 8px; color: #374151; }
  .tips ol { margin: 0; padding-left: 18px; color: #4b5563; font-size: 13px; line-height: 1.7; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">📦</div>
    <h1>服装进销存</h1>
    <p class="sub">Android 安装包下载</p>
    ${body}
  </div>
</body>
</html>`;
}
