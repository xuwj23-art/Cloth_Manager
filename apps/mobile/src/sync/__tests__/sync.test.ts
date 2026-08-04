import { describe, it, expect } from "vitest";
import { classifySyncError } from "../sync";

describe("classifySyncError（同步错误分类）", () => {
  it("400 业务拒绝 → failed（不重试）", () => {
    expect(classifySyncError(400)).toBe("failed");
  });

  it("409 冲突 → failed", () => {
    expect(classifySyncError(409)).toBe("failed");
  });

  it("500 服务端错 → pending（重试）", () => {
    expect(classifySyncError(500)).toBe("pending");
  });

  it("network 网络错 → pending", () => {
    expect(classifySyncError("network")).toBe("pending");
  });
});
