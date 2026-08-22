import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DownloadApkService } from "./download-apk.service";

/** 每个用例独立的临时目录，模拟生产 ./apk 挂载目录 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "apk-versions-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function touch(name: string, content = "x"): void {
  writeFileSync(join(dir, name), content);
}

describe("DownloadApkService 多版本管理", () => {
  it("扫描 app-x.y.z.apk 并按版本号降序（1.10.0 > 1.9.0）", () => {
    touch("app-1.9.0.apk");
    touch("app-1.10.0.apk");
    touch("app-1.2.0.apk");
    const svc = new DownloadApkService(dir);
    const versions = svc.listVersions();
    expect(versions.map((v) => v.version)).toEqual(["1.10.0", "1.9.0", "1.2.0"]);
  });

  it("忽略无关文件，裸 app.apk 识别为 legacy 且排最后", () => {
    touch("app-1.2.0.apk");
    touch("app.apk");
    touch("current.json", "{}");
    touch("readme.txt");
    mkdirSync(join(dir, "subdir"));
    const versions = new DownloadApkService(dir).listVersions();
    expect(versions).toHaveLength(2);
    expect(versions[1]!.isLegacy).toBe(true);
    expect(versions[1]!.version).toBeNull();
  });

  it("默认生效版本 = 版本号最高者", () => {
    touch("app-1.2.0.apk");
    touch("app-1.2.1.apk");
    expect(new DownloadApkService(dir).resolveActive()?.version).toBe("1.2.1");
  });

  it("current.json.active 可固定生效版本（回滚机制）", () => {
    touch("app-1.2.0.apk", "old");
    touch("app-1.2.1.apk", "new");
    touch("current.json", JSON.stringify({ active: "app-1.2.0.apk" }));
    expect(new DownloadApkService(dir).resolveActive()?.version).toBe("1.2.0");
  });

  it("current.json.active 指向不存在的文件时回落到最高版本（不 404）", () => {
    touch("app-1.2.1.apk");
    touch("current.json", JSON.stringify({ active: "app-9.9.9.apk" }));
    expect(new DownloadApkService(dir).resolveActive()?.version).toBe("1.2.1");
  });

  it("current.json 损坏时按无配置处理", () => {
    touch("app-1.2.1.apk");
    touch("current.json", "{broken json");
    expect(new DownloadApkService(dir).resolveActive()?.version).toBe("1.2.1");
  });

  it("notes 会挂到对应版本条目上", () => {
    touch("app-1.2.1.apk");
    touch("current.json", JSON.stringify({ notes: { "app-1.2.1.apk": "修复扫码/离线登出" } }));
    expect(new DownloadApkService(dir).listVersions()[0]!.note).toBe("修复扫码/离线登出");
  });

  it("只有裸 app.apk 时它就是生效版本（兼容存量部署）", () => {
    touch("app.apk");
    expect(new DownloadApkService(dir).resolveActive()?.isLegacy).toBe(true);
  });

  it("空目录返回空列表，resolveActive 为 null", () => {
    const svc = new DownloadApkService(dir);
    expect(svc.listVersions()).toEqual([]);
    expect(svc.resolveActive()).toBeNull();
  });

  it("safeResolveFile 拒绝路径穿越与未列出的文件", () => {
    touch("app-1.2.0.apk");
    touch("app.apk");
    writeFileSync(join(dir, "secret.txt"), "s");
    const svc = new DownloadApkService(dir);
    expect(svc.safeResolveFile("app-1.2.0.apk")).toBe(join(dir, "app-1.2.0.apk"));
    expect(svc.safeResolveFile("app.apk")).toBe(join(dir, "app.apk"));
    expect(svc.safeResolveFile("../secret.txt")).toBeNull();
    expect(svc.safeResolveFile("..%2Fsecret.txt")).toBeNull();
    expect(svc.safeResolveFile("secret.txt")).toBeNull();
    expect(svc.safeResolveFile("app-99.0.0.apk")).toBeNull(); // 文件名合法但不存在
    expect(svc.safeResolveFile("app-1.2.0.apk.exe")).toBeNull();
  });
});
