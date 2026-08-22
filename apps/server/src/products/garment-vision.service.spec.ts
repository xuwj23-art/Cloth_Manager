import { BadRequestException, HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  classifyVisionHttpError,
  GarmentVisionService,
  InvalidImagePathError,
  resolveUploadImagePath,
  VisionException,
  type GarmentVisionClock,
} from "./garment-vision.service";

const UPLOADS = "C:\\tmp\\uploads";

function okResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function httpResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

function visionPayload(name: string, category: string, color: string) {
  return {
    choices: [{ message: { content: JSON.stringify({ name, category, color }) } }],
  };
}

function makeService(
  partial: Partial<GarmentVisionClock> & { fetchFn: GarmentVisionClock["fetchFn"] },
) {
  const service = new GarmentVisionService();
  service.clock = {
    fetchFn: partial.fetchFn,
    readFile: partial.readFile ?? (async () => Buffer.from("fake-jpeg")),
    sleep: partial.sleep ?? (async () => undefined),
    uploadsDir: partial.uploadsDir ?? UPLOADS,
    apiKey: partial.apiKey === undefined ? "sk-test" : partial.apiKey,
    model: partial.model ?? "qwen3-vl-plus",
  };
  return service;
}

describe("resolveUploadImagePath", () => {
  it("拒绝路径穿越、URL、盘符", () => {
    expect(() => resolveUploadImagePath("../etc/passwd", UPLOADS)).toThrow(InvalidImagePathError);
    expect(() => resolveUploadImagePath("/uploads/../etc/passwd", UPLOADS)).toThrow(
      InvalidImagePathError,
    );
    expect(() => resolveUploadImagePath("http://evil.example/x.jpg", UPLOADS)).toThrow(
      InvalidImagePathError,
    );
    expect(() => resolveUploadImagePath("https://evil.example/x.jpg", UPLOADS)).toThrow(
      InvalidImagePathError,
    );
    expect(() => resolveUploadImagePath("C:\\\\Windows\\\\x.jpg", UPLOADS)).toThrow(
      InvalidImagePathError,
    );
    expect(() => resolveUploadImagePath("/etc/passwd", UPLOADS)).toThrow(InvalidImagePathError);
  });

  it("合法 /uploads/uuid.jpg 拼到 uploads 目录", () => {
    const p = resolveUploadImagePath("/uploads/abc-def.jpg", UPLOADS);
    expect(p.replace(/\\/g, "/")).toMatch(/uploads\/abc-def\.jpg$/);
    expect(p.includes("..")).toBe(false);
  });
});

describe("classifyVisionHttpError", () => {
  it("401 / invalid_api_key 不重试", () => {
    const a = classifyVisionHttpError(401, `{"error":{"code":"invalid_api_key"}}`);
    expect(a.retryable).toBe(false);
    expect(a.code).toBe("invalid_key");
  });

  it("额度/欠费不重试", () => {
    expect(classifyVisionHttpError(402, "Arrearage").code).toBe("quota");
    expect(classifyVisionHttpError(403, "insufficient_quota").retryable).toBe(false);
    expect(classifyVisionHttpError(400, "余额不足").code).toBe("quota");
  });

  it("内容审核不重试", () => {
    const a = classifyVisionHttpError(400, "data_inspection_failed");
    expect(a.retryable).toBe(false);
    expect(a.code).toBe("unsafe");
  });

  it("429/5xx 可重试", () => {
    expect(classifyVisionHttpError(429, "").retryable).toBe(true);
    expect(classifyVisionHttpError(503, "").retryable).toBe(true);
    expect(classifyVisionHttpError(502, "").retryable).toBe(true);
  });
});

describe("GarmentVisionService.recognize", () => {
  it("未配密钥立刻 invalid_key，不发请求", async () => {
    const fetchFn = vi.fn();
    const service = makeService({ fetchFn, apiKey: "" });
    await expect(service.recognize("/uploads/a.jpg")).rejects.toMatchObject({
      visionCode: "invalid_key",
      retryable: false,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("非法路径 400，不发请求", async () => {
    const fetchFn = vi.fn();
    const service = makeService({ fetchFn });
    await expect(service.recognize("../etc/passwd")).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("映射：裙子→连衣裙、大红→红", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(okResponse(visionPayload("红色连衣裙", "裙子", "大红")));
    const service = makeService({ fetchFn });
    const r = await service.recognize("/uploads/abc.jpg");
    expect(r.category).toBe("连衣裙");
    expect(r.color).toBe("红");
    expect(r.colorIsPreset).toBe(true);
    expect(r.categoryIsPreset).toBe(true);
    expect(r.source).toBe("vision");
    expect(r.name.length).toBeGreaterThanOrEqual(5);
  });

  it("酒红保持自定义，不是默认", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(okResponse(visionPayload("连衣裙", "连衣裙", "酒红")));
    const service = makeService({ fetchFn });
    const r = await service.recognize("/uploads/abc.jpg");
    expect(r.color).toBe("酒红");
    expect(r.colorIsPreset).toBe(false);
    expect(r.color).not.toBe("默认");
  });

  it("401 不重试", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(httpResponse(401, { error: { code: "invalid_api_key" } }));
    const service = makeService({ fetchFn });
    await expect(service.recognize("/uploads/abc.jpg")).rejects.toMatchObject({
      visionCode: "invalid_key",
      retryable: false,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("两次 503 后 200 成功", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(httpResponse(503, "unavailable"))
      .mockResolvedValueOnce(httpResponse(503, "unavailable"))
      .mockResolvedValueOnce(okResponse(visionPayload("红色连衣裙", "裙子", "大红")));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const service = makeService({ fetchFn, sleep });
    const r = await service.recognize("/uploads/abc.jpg");
    expect(r.color).toBe("红");
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("三次超时 → retry_exhausted", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchFn = vi.fn().mockRejectedValue(abort);
    const service = makeService({ fetchFn });
    try {
      await service.recognize("/uploads/abc.jpg");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(VisionException);
      expect((e as VisionException).visionCode).toBe("retry_exhausted");
      expect((e as VisionException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    }
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
