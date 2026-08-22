/**
 * UI 设计语言 token（见 docs/design/UI-REFERENCES.md §3）。
 *
 * 第 4 波 Task 2 落地 CashierScreen 时建立，供 CashierScreen 子组件统一引用。
 * 品牌色沿用重构前蓝色 #2563eb（用户偏好），其余 token 不变。
 */

/** 配色（§3.1：浅灰底 + 卡片纯白 + 单一品牌色） */
export const colors = {
  /** 页面背景：浅灰护眼（非纯白） */
  bg: "#F5F5F7",
  /** 卡片底色 */
  card: "#FFFFFF",
  /** 品牌主色：蓝（沿用重构前风格，金额/结算按钮强调） */
  primary: "#2563eb",
  /** 品牌主色按下态（轻微压暗） */
  primaryPressed: "#1d4ed8",
  /** 品牌主色浅底（步进器底色、选中态衬底） */
  primarySoft: "#eef2ff",
  /** 主文字 */
  text: "#1A1A1A",
  /** 辅助文字 */
  textMuted: "#6B7280",
  /** 边框/分割线（少用，信息层级靠字号与留白） */
  border: "#E5E7EB",
  /** 强调红（库存预警/原价删除线/折扣标签） */
  danger: "#E11D48",
  /** 强调红浅底（折扣标签） */
  dangerSoft: "#FEE2E2",
  /** 离线橙（网络状态点） */
  warn: "#F59E0B",
  /** 在线绿（网络状态点） */
  online: "#16A34A",
  /** 遮罩 */
  backdrop: "rgba(0,0,0,0.45)",
  /** 品牌金（吊牌 logo） */
  gold: "#C0A065",
} as const;

/** 字号 sp（§3.2：正文不低于 16sp） */
export const font = {
  /** 金额大数字（营业额/总价） */
  display: 36,
  /** 标题/品名 */
  title: 18,
  /** 正文/字段标签（中老年最小可读） */
  body: 16,
  /** 辅助信息（时间/库存） */
  caption: 14,
} as const;

/** 品牌衬线（Noto Serif SC 子集，仅用于「收银台」等已收录字） */
export const fontFamily = {
  brand: "NotoSerifSC",
} as const;

/** 点击区 dp（§3.3：最小 48dp，步进器/按钮建议 56dp） */
export const touch = {
  /** 无障碍最小点击区 */
  minSize: 48,
  /** 大按钮/步进器推荐高度 */
  buttonHeight: 56,
} as const;

/** 动画时长 ms（§3.4：150-250ms，过快看不见、过慢以为卡住） */
export const motion = {
  /** 页面/横向切换 */
  pageMs: 220,
  /** 卡片/确认卡淡入 */
  cardMs: 150,
  /** 列表项 stagger 错位 */
  staggerMs: 30,
} as const;

/** 间距 dp（少用分割线，靠留白分层） */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

/** 圆角 dp */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;
