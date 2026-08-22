/**
 * APK 下载页 HTML 模板（多版本可选）。
 *
 * 设计要点：
 *  - 单文件自包含：内联 CSS、无外部资源依赖，确保离线/弱网也能渲染
 *  - 移动优先：viewport 锁缩放、按钮 44px+ 触控热区、PingFang/YaHei 字体栈
 *  - 主题色 #2563eb 蓝色渐变背景 + 白色圆角卡片（与移动端品牌色一致）
 *  - 生效版本大按钮置顶（固定走 /download/app.apk，与二维码/书签一致），
 *    其余历史版本列表每行独立下载链接，出问题可随时装回旧版
 *
 * QR 二维码由 controller 用 qrcode 库生成 dataURL 后传入。
 * 版本号/备注等文本经 escapeHtml 转义（内容来自运营者手写的文件名/current.json）。
 */

/** 渲染入参：单个版本行 */
export interface DownloadPageVersion {
  /** 文件名（app-1.2.1.apk） */
  file: string;
  /** 展示用版本号（裸 app.apk 显示「未标注版本」） */
  version: string;
  /** 体积（MB，已格式化字符串） */
  sizeMB: string;
  /** 上传时间（已格式化中文时间串） */
  updated: string;
  /** 更新说明（可为空） */
  note: string;
  /** 是否当前生效版本 */
  isActive: boolean;
}

/** 渲染入参：整页 */
export interface DownloadPageData {
  versions: DownloadPageVersion[];
  /** 二维码 dataURL（PNG base64） */
  qr: string;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 渲染整页 HTML（controller 以 text/html 发送） */
export function renderDownloadPage(d: DownloadPageData): string {
  const active = d.versions.find((v) => v.isActive);
  const rows = d.versions
    .map((v) => {
      const badge = v.isActive ? `<span class="badge">当前</span>` : "";
      const note = v.note ? `<p class="vnote">${escapeHtml(v.note)}</p>` : "";
      return `
      <div class="vrow">
        <div class="vinfo">
          <p class="vname">${escapeHtml(v.version)} ${badge}</p>
          <p class="vmeta">${v.sizeMB} MB · ${v.updated}</p>
          ${note}
        </div>
        <a class="vbtn" href="/download/apk/${encodeURIComponent(v.file)}">下载</a>
      </div>`;
    })
    .join("");

  const body =
    d.versions.length === 0
      ? `<p class="meta">安装包尚未上传，请稍后再来。</p>`
      : `
      <a class="btn" href="/download/app.apk">下载当前版本（${escapeHtml(active?.version ?? "")}）</a>
      ${d.qr ? `<div class="qrbox"><img class="qr" src="${d.qr}" alt="二维码" /><p class="qrtip">手机扫码打开此页面</p></div>` : ""}
      <div class="tips">
        <h3>安装步骤</h3>
        <ol>
          <li>用<b>手机浏览器</b>打开本页面，点上方按钮下载。</li>
          <li>下载完成后点开安装；若提示「未知来源」，按提示<b>允许安装</b>即可。</li>
          <li>从旧版（云端版）换装本版本，需先卸载旧 App 再安装。</li>
        </ol>
      </div>
      ${
        d.versions.length > 1
          ? `<h3 class="vh">全部版本</h3><p class="vsub">新版有问题时可装回旧版（覆盖安装即可）</p>`
          : ""
      }
      <div class="vlist">${rows}</div>`;

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
  .vh { font-size: 14px; color: #374151; text-align: left; margin: 22px 0 2px; }
  .vsub { color: #9ca3af; font-size: 12px; text-align: left; margin: 0 0 8px; }
  .vlist { text-align: left; }
  .vrow {
    display: flex; align-items: center; gap: 10px;
    border: 1px solid #eef2f7; border-radius: 12px; padding: 10px 12px; margin-bottom: 8px;
  }
  .vinfo { flex: 1; min-width: 0; }
  .vname { margin: 0; font-size: 15px; font-weight: 700; color: #111; }
  .vmeta { margin: 2px 0 0; color: #9ca3af; font-size: 12px; }
  .vnote { margin: 4px 0 0; color: #6b7280; font-size: 12px; }
  .badge {
    display: inline-block; background: #dcfce7; color: #15803d; font-size: 11px;
    font-weight: 700; border-radius: 6px; padding: 1px 6px; vertical-align: 2px;
  }
  .vbtn {
    flex-shrink: 0; background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe;
    text-decoration: none; font-size: 14px; font-weight: 700;
    padding: 8px 16px; border-radius: 10px;
  }
  .vbtn:active { background: #dbeafe; }
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
