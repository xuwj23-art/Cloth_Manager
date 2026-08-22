import { BadRequestException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  mapGarmentVision,
  PRESET_CATEGORIES,
  PRESET_COLORS,
  RecognizeGarmentResult,
  VISION_ERROR_MESSAGES,
  type GarmentVisionRaw,
  type VisionErrorCode,
} from "@cloth-scan/shared";
import { UPLOADS_DIR } from "../uploads/uploads.constants";

export const DASHSCOPE_COMPAT_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
export const UPSTREAM_TIMEOUT_MS = 12_000;
export const VISION_RETRY_DELAYS_MS = [800, 2000] as const;
export const MAX_VISION_ATTEMPTS = 3;

export class InvalidImagePathError extends Error {
  constructor() {
    super("图片路径无效");
    this.name = "InvalidImagePathError";
  }
}

export class VisionException extends HttpException {
  constructor(
    public readonly visionCode: VisionErrorCode,
    message: string,
    status: number,
    public readonly retryable: boolean,
  ) {
    super({ code: visionCode, message }, status);
  }
}

export type GarmentVisionClock = {
  fetchFn: typeof fetch;
  readFile: (path: string) => Promise<Buffer>;
  sleep: (ms: number) => Promise<void>;
  uploadsDir: string;
  apiKey?: string;
  model: string;
};

export function defaultGarmentVisionClock(): GarmentVisionClock {
  return {
    fetchFn: (...args) => globalThis.fetch(...args),
    readFile: (p) => readFile(p),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    uploadsDir: UPLOADS_DIR,
    apiKey: process.env.DASHSCOPE_API_KEY?.trim() || undefined,
    model: process.env.GARMENT_VISION_MODEL?.trim() || "qwen3-vl-plus",
  };
}

/** 只允许本店上传返回的 `/uploads/<filename>`，拒绝 URL、盘符、路径穿越。 */
export function resolveUploadImagePath(imagePath: string, uploadsDir: string): string {
  const trimmed = (imagePath ?? "").trim();
  if (!trimmed) throw new InvalidImagePathError();
  if (/^https?:\/\//i.test(trimmed) || /^file:/i.test(trimmed)) {
    throw new InvalidImagePathError();
  }
  if (trimmed.includes("..") || /%2e/i.test(trimmed)) throw new InvalidImagePathError();
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\") || trimmed.startsWith("//")) {
    throw new InvalidImagePathError();
  }
  const m = trimmed.match(/^\/uploads\/([^/\\]+)$/);
  if (!m) throw new InvalidImagePathError();
  const filename = m[1];
  if (!/^[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i.test(filename)) {
    throw new InvalidImagePathError();
  }
  const full = resolve(join(uploadsDir, filename));
  const root = resolve(uploadsDir);
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new InvalidImagePathError();
  return full;
}

export function classifyVisionHttpError(
  status: number,
  bodyText: string,
): { retryable: boolean; code: VisionErrorCode; message: string } {
  const lower = (bodyText || "").toLowerCase();
  const msg = VISION_ERROR_MESSAGES;

  if (status === 401 || lower.includes("invalid_api_key") || lower.includes("incorrect api key")) {
    return { retryable: false, code: "invalid_key", message: msg.invalid_key };
  }
  if (
    status === 402 ||
    lower.includes("insufficient_quota") ||
    lower.includes("arrearage") ||
    bodyText.includes("余额不足") ||
    (lower.includes("quota") && (lower.includes("exceed") || lower.includes("not_enough")))
  ) {
    return { retryable: false, code: "quota", message: msg.quota };
  }
  if (
    lower.includes("data_inspection") ||
    lower.includes("responsibleaipolicy") ||
    lower.includes("content_filter") ||
    bodyText.includes("内容审核")
  ) {
    return { retryable: false, code: "unsafe", message: msg.unsafe };
  }
  if (status === 429 || status >= 500) {
    return { retryable: true, code: "retry_exhausted", message: msg.retry_exhausted };
  }
  if (status === 400) {
    return { retryable: false, code: "unsafe", message: msg.unsafe };
  }
  return { retryable: true, code: "retry_exhausted", message: msg.retry_exhausted };
}

export function buildGarmentVisionSystemPrompt(): string {
  return [
    "你是服装店建档助手。只根据图片识别一件衣服。",
    "只输出一个 JSON 对象，不要 Markdown，不要解释。",
    "字段：",
    "- name: 商品名称，5到20个汉字，像吊牌品名，不要品牌、不要标点、不要价格",
    `- category: 品类。优先从下列选一个：${PRESET_CATEGORIES.join("、")}`,
    "  列表没有则用不超过10字的短词。",
    `- color: 主色。优先从下列选：${PRESET_COLORS.join("、")}`,
    "  印花、碎花、撞色、多色用「花色」。",
    "  对不上用不超过6个汉字的颜色词（如酒红、墨绿）。",
    "  禁止写「默认」，禁止 RGB，禁止长句。",
    '示例：{"name":"酒红连衣裙","category":"连衣裙","color":"酒红"}',
  ].join("\n");
}

export function parseVisionContent(content: string): GarmentVisionRaw {
  const trimmed = (content || "").trim();
  if (!trimmed) throw new Error("EMPTY_CONTENT");
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fence ? fence[1] : trimmed;
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("NO_JSON");
  const obj = JSON.parse(jsonText.slice(start, end + 1)) as Record<string, unknown>;
  return {
    name: String(obj.name ?? ""),
    category: String(obj.category ?? ""),
    color: String(obj.color ?? ""),
  };
}

function mimeOf(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function extractMessageContent(data: unknown): string {
  const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : String((p as { text?: string })?.text ?? "")))
      .join("");
  }
  return "";
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

@Injectable()
export class GarmentVisionService {
  clock: GarmentVisionClock = defaultGarmentVisionClock();

  async recognize(imagePath: string): Promise<RecognizeGarmentResult> {
    const key = this.clock.apiKey;
    if (!key) {
      throw new VisionException(
        "invalid_key",
        VISION_ERROR_MESSAGES.invalid_key,
        HttpStatus.SERVICE_UNAVAILABLE,
        false,
      );
    }

    let absPath: string;
    try {
      absPath = resolveUploadImagePath(imagePath, this.clock.uploadsDir);
    } catch {
      throw new BadRequestException("图片路径无效");
    }

    let bytes: Buffer;
    try {
      bytes = await this.clock.readFile(absPath);
    } catch {
      throw new BadRequestException("图片不存在，请重新拍照");
    }

    let lastRetryable: VisionException | null = null;
    for (let attempt = 0; attempt < MAX_VISION_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const delay = VISION_RETRY_DELAYS_MS[attempt - 1] ?? 2000;
        await this.clock.sleep(delay);
      }
      try {
        return await this.callOnce(key, absPath, bytes);
      } catch (e) {
        if (e instanceof VisionException && !e.retryable) throw e;
        if (e instanceof VisionException) lastRetryable = e;
        else if (e instanceof BadRequestException) throw e;
        else if (isAbortError(e) || e instanceof TypeError) {
          lastRetryable = new VisionException(
            "retry_exhausted",
            VISION_ERROR_MESSAGES.retry_exhausted,
            HttpStatus.SERVICE_UNAVAILABLE,
            true,
          );
        } else {
          lastRetryable = new VisionException(
            "retry_exhausted",
            VISION_ERROR_MESSAGES.retry_exhausted,
            HttpStatus.SERVICE_UNAVAILABLE,
            true,
          );
        }
      }
    }
    throw (
      lastRetryable ??
      new VisionException(
        "retry_exhausted",
        VISION_ERROR_MESSAGES.retry_exhausted,
        HttpStatus.SERVICE_UNAVAILABLE,
        true,
      )
    );
  }

  private async callOnce(
    apiKey: string,
    absPath: string,
    bytes: Buffer,
  ): Promise<RecognizeGarmentResult> {
    const dataUrl = `data:${mimeOf(absPath)};base64,${bytes.toString("base64")}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.clock.fetchFn(DASHSCOPE_COMPAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.clock.model,
          messages: [
            { role: "system", content: buildGarmentVisionSystemPrompt() },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUrl } },
                { type: "text", text: "识别图中这件衣服，按规则输出 JSON" },
              ],
            },
          ],
          max_tokens: 256,
          response_format: { type: "json_object" },
          enable_thinking: false,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const bodyText = await res.text();
    if (!res.ok) {
      const cls = classifyVisionHttpError(res.status, bodyText);
      throw new VisionException(
        cls.code,
        cls.message,
        cls.retryable
          ? HttpStatus.SERVICE_UNAVAILABLE
          : cls.code === "unsafe"
            ? HttpStatus.BAD_REQUEST
            : HttpStatus.SERVICE_UNAVAILABLE,
        cls.retryable,
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(bodyText);
    } catch {
      throw new VisionException(
        "retry_exhausted",
        VISION_ERROR_MESSAGES.retry_exhausted,
        HttpStatus.SERVICE_UNAVAILABLE,
        true,
      );
    }

    let raw: GarmentVisionRaw;
    try {
      raw = parseVisionContent(extractMessageContent(parsedJson));
    } catch {
      throw new VisionException(
        "retry_exhausted",
        VISION_ERROR_MESSAGES.retry_exhausted,
        HttpStatus.SERVICE_UNAVAILABLE,
        true,
      );
    }

    const mapped = mapGarmentVision(raw);
    return { ...mapped, source: "vision" };
  }
}
