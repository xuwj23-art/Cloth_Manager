import { BadRequestException, PipeTransform } from "@nestjs/common";
import { ZodSchema } from "zod";

/**
 * 用共享包里的 Zod schema 校验请求体。
 * 用法：@Body(new ZodValidationPipe(CreateProductInput)) body: CreateProductInput
 */
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "参数校验失败",
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}
