/**
 * 通用格式化工具：金额、时间。
 *
 * 设计语言（UI-REFERENCES §3）：金额统一半角 `¥X.XX`（屏幕显示）；
 * 时间戳统一 `YYYY-MM-DD HH:mm`（本地时区）。
 */

/** 分 → "¥123.45"（半角符号，用于屏幕显示） */
export function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/** ISO 字符串 → "YYYY-MM-DD HH:mm"（本地时区） */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}
