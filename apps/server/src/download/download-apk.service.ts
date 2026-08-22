import { Injectable, Optional } from "@nestjs/common";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { APK_NAME, CURRENT_JSON, DOWNLOAD_DIR } from "./download.constants";

/** 目录里的一个 APK 版本条目 */
export interface ApkVersion {
  /** 文件名（同时是对外下载路径 /download/apk/<file> 的一段） */
  file: string;
  /** 从文件名解析出的版本号（app-1.2.0.apk → "1.2.0"）；裸 app.apk 为 null */
  version: string | null;
  /** 体积（字节） */
  sizeBytes: number;
  /** 文件修改时间（ms） */
  mtimeMs: number;
  /** 备注（来自 current.json.notes[file]，可为空） */
  note: string;
  /** 是否为无版本号的旧式 app.apk */
  isLegacy: boolean;
}

/** current.json：运营者手写的生效版本与备注（均可选） */
interface CurrentConfig {
  /** 生效版本文件名；不写 = 自动取最高版本 */
  active?: string;
  /** 每个版本文件的更新说明，如 { "app-1.2.1.apk": "修复扫码/离线登出" } */
  notes?: Record<string, string>;
}

/** 文件名 → 版本号。仅认 app-x.y.z.apk（三段数字），其余（含裸 app.apk）不视为版本化文件 */
const VERSIONED_RE = /^app-(\d+)\.(\d+)\.(\d+)\.apk$/;

/** 比较两个版本号字符串（"1.10.0" > "1.9.0"），非法版本视为最小 */
function compareVersionDesc(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // 无版本号的 legacy 排最后
  if (b === null) return -1;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pb[i]! - pa[i]!;
  }
  return 0;
}

/**
 * APK 多版本管理（纯文件驱动，无数据库）：
 *
 * 目录结构（DOWNLOAD_DIR，生产为宿主机 ./apk 挂载）：
 *   app-1.2.0.apk / app-1.2.1.apk ...   ← 带版本号的安装包，scp 上传即入库
 *   app.apk                             ← 旧式覆盖式包（兼容保留）
 *   current.json                        ← { "active": "app-1.2.1.apk", "notes": {...} }（可选）
 *
 * 生效版本（/download/app.apk 与下载页默认按钮）：
 *   current.json.active 指定的文件 > 版本号最高的文件 > 裸 app.apk。
 *   回滚 = 改 active 一行；删 current.json = 回到自动取最高版本。
 */
@Injectable()
export class DownloadApkService {
  private readonly dir: string;

  /**
   * 测试可注入临时目录；生产由 Nest 注入 undefined 时回落到 download.constants 的固定目录。
   * （@Optional 是必须的：Nest 会尝试按 String token 解析构造参数，无该装饰器直接启动失败）
   */
  constructor(@Optional() dir?: string) {
    this.dir = dir ?? DOWNLOAD_DIR;
  }

  /** 扫描目录，返回全部 APK（版本降序；legacy app.apk 恒排最后） */
  listVersions(): ApkVersion[] {
    if (!existsSync(this.dir)) return [];
    const cfg = this.readCurrentConfig();
    const entries: ApkVersion[] = [];
    for (const name of readdirSync(this.dir)) {
      const m = VERSIONED_RE.exec(name);
      const isLegacy = name === APK_NAME;
      if (!m && !isLegacy) continue;
      const full = join(this.dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue; // 竞态：扫描瞬间被删/不是普通文件
      }
      if (!st.isFile()) continue;
      entries.push({
        file: name,
        version: m ? `${m[1]}.${m[2]}.${m[3]}` : null,
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
        note: cfg.notes?.[name] ?? "",
        isLegacy,
      });
    }
    return entries.sort((a, b) => compareVersionDesc(a.version, b.version));
  }

  /** 当前生效版本（规则见类注释）；目录为空返回 null */
  resolveActive(): ApkVersion | null {
    const versions = this.listVersions();
    if (versions.length === 0) return null;
    const cfg = this.readCurrentConfig();
    if (cfg.active) {
      const pinned = versions.find((v) => v.file === cfg.active);
      if (pinned) return pinned;
      // active 指向不存在的文件：忽略并回落到自动规则（不 404，保证下载页永远可用）
    }
    return versions[0]!;
  }

  /**
   * 对外下载路径的文件名安全解析：仅允许目录里实际存在的 app-x.y.z.apk / app.apk，
   * 防 ../ 路径穿越与任意文件读取。返回绝对路径，非法返回 null。
   */
  safeResolveFile(file: string): string | null {
    if (!VERSIONED_RE.test(file) && file !== APK_NAME) return null;
    if (!this.listVersions().some((v) => v.file === file)) return null;
    return join(this.dir, file);
  }

  /** 供下载流使用：校验文件名并返回绝对路径与字节数（非法返回 null） */
  statFile(file: string): { path: string; size: number } | null {
    const path = this.safeResolveFile(file);
    if (!path) return null;
    return { path, size: statSync(path).size };
  }

  /** 读取 current.json（不存在/损坏/非对象一律按无配置处理，绝不抛错影响下载页） */
  private readCurrentConfig(): CurrentConfig {
    try {
      const raw = readFileSync(join(this.dir, CURRENT_JSON), "utf8");
      const parsed = JSON.parse(raw) as CurrentConfig;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // 不存在或 JSON 损坏：忽略
    }
    return {};
  }
}
