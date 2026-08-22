import { z } from "zod";

export const VisionErrorCode = z.enum([
  "vision_unavailable",
  "quota",
  "invalid_key",
  "retry_exhausted",
  "unsafe",
]);
export type VisionErrorCode = z.infer<typeof VisionErrorCode>;

export const RecognizeGarmentInput = z.object({
  imagePath: z.string().min(1).max(512),
});
export type RecognizeGarmentInput = z.infer<typeof RecognizeGarmentInput>;

export const RecognizeGarmentResult = z.object({
  name: z.string(),
  category: z.string(),
  color: z.string(),
  colorIsPreset: z.boolean(),
  categoryIsPreset: z.boolean(),
  source: z.literal("vision"),
});
export type RecognizeGarmentResult = z.infer<typeof RecognizeGarmentResult>;

export const VISION_ERROR_MESSAGES: Record<VisionErrorCode, string> = {
  invalid_key: "识图暂未开通（密钥无效），请改用手动入库",
  quota: "识图额度不足，请改用手动入库",
  unsafe: "这张图无法识别，请重拍正面或改用手动入库",
  retry_exhausted: "识别超时，请点重试或改用手动入库",
  vision_unavailable: "识图暂未开通，请改用手动入库",
};
