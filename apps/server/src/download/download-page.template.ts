import { APK_NAME } from "./download.constants";

/**
 * APK 下载页 HTML 模板（E7：从 download.controller.ts 抽离）。
 *
 * 设计要点：
 *  - 单文件自包含：内联 CSS、无外部资源依赖，确保离线/弱网也能渲染
 *  - 移动优先：viewport 锁缩放、按钮 44px+ 触控热区、PingFang/YaHei 字体栈
 *  - 主题色 #2563eb 蓝色渐变背景 + 白色圆角卡片（与移动端品牌色一致）
 *
 * QR 二维码由调用方（download.controller）用 qrcode 库生成 dataURL 后传入，
 * 此处只负责把它嵌进 <img src>。
 */

/** 渲染入参：均由 controller 在请求时计算 */
export interface DownloadPageData {
  /** APK 文件是否已上传（决定显示下载按钮 or 提示尚未上传） */
  exists: boolean;
  /** APK 体积（MB，已格式化的字符串，如 "12.3"） */
  sizeMB: string;
  /** APK 最近更新时间（已格式化的中文时间串） */
  updated: string;
  /** 版本号（来自 version.txt，可为空） */
  version: string;
  /** 二维码 dataURL（PNG base64），由 controller 调 QRCode.toDataURL 生成 */
  qr: string;
}

/**
 * 渲染整页 HTML。返回字符串（controller 以 text/html 发送）。
 * 模板内只做简单插值，不做转义（数据全部来自服务端可信来源：文件大小/版本/自生成 QR）。
 */
export function renderDownloadPage(d: DownloadPageData): string {
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
