import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { OperatorSalesStat, SaleOrderDetail } from "@cloth-scan/shared";
import { colors, font, radius, space } from "../../theme/tokens";
import { yuan } from "../../utils/format";

/**
 * 销售统计重构的 UI 部件集。
 * 设计语言：延续 App 浅色卡片体系；签名元素 = 顶部「夜色账本」深墨蓝 Hero 卡
 * （白色营业额大数字 + 品牌金毛利 + 当前时段角标），图表与列表保持克制单色。
 */

export type Granularity = "day" | "week" | "month";

/** 员工头像配色：按名字哈希取色，同一个人跨视图颜色稳定 */
const OPERATOR_PALETTE = ["#2563EB", "#C0A065", "#0EA472", "#8B5CF6", "#F97316", "#64748B"];

function operatorColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return OPERATOR_PALETTE[h % OPERATOR_PALETTE.length]!;
}

/** 统一金额格式：千分位；≥ ¥1000 去小数（本屏所有金额展示位共用，避免同卡内小数位不一） */
export function fmtMoney(cents: number): string {
  const v = cents / 100;
  if (Math.abs(v) >= 1000) return `¥${Math.round(v).toLocaleString("zh-CN")}`;
  return `¥${v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Hero 副指标金额：≥ ¥1000 去小数（列窄防折行） */
function yuanStat(cents: number): string {
  const v = cents / 100;
  if (Math.abs(v) >= 1000) return `¥${Math.round(v).toLocaleString("zh-CN")}`;
  return yuan(cents);
}

/** 柱顶数值：不带 ¥，≥ 1 万用「万」字 */
function fmtBarValue(cents: number): string {
  const v = cents / 100;
  if (v >= 10000) return `${(v / 10000).toFixed(1).replace(/\.0$/, "")}万`;
  return Math.round(v).toLocaleString("zh-CN");
}

// ---------------------------------------------------------------------------
// 时段切换：粒度分段（滑块动画）+ 上一期/下一期步进（大号箭头、纯数字标签）
// ---------------------------------------------------------------------------

const GRAN_LIST: { key: Granularity; text: string }[] = [
  { key: "day", text: "日" },
  { key: "week", text: "周" },
  { key: "month", text: "月" },
];
const SEG_W = 52;

export function PeriodSwitcher({
  gran,
  onGran,
  label,
  onPrev,
  onNext,
  nextDisabled,
}: {
  gran: Granularity;
  onGran: (g: Granularity) => void;
  label: string; // 纯数字+符号："7·21" / "7·21–27" / "2026·7"
  onPrev: () => void;
  onNext: () => void;
  nextDisabled: boolean;
}) {
  const idx = Math.max(
    0,
    GRAN_LIST.findIndex((g) => g.key === gran),
  );
  const segX = useRef(new Animated.Value(idx * SEG_W)).current;
  useEffect(() => {
    Animated.spring(segX, {
      toValue: idx * SEG_W,
      useNativeDriver: true,
      speed: 26,
      bounciness: 2,
    }).start();
  }, [idx, segX]);

  return (
    <View style={psStyles.row}>
      <View style={psStyles.segment}>
        <Animated.View style={[psStyles.segThumb, { transform: [{ translateX: segX }] }]} />
        {GRAN_LIST.map((g) => (
          <Pressable
            key={g.key}
            style={psStyles.segBtn}
            onPress={() => onGran(g.key)}
            accessibilityRole="button"
            accessibilityLabel={`按${g.text}查看`}
          >
            <Text style={[psStyles.segText, gran === g.key && psStyles.segTextOn]}>{g.text}</Text>
          </Pressable>
        ))}
      </View>
      <View style={psStyles.stepper}>
        <Pressable
          style={({ pressed }) => [psStyles.stepArrow, pressed && psStyles.stepArrowPressed]}
          onPress={onPrev}
          accessibilityRole="button"
          accessibilityLabel="上一期"
        >
          <Ionicons name="chevron-back" size={22} color="#1A1A1A" />
        </Pressable>
        <Text style={psStyles.stepLabelText} numberOfLines={1} allowFontScaling={false}>
          {label}
        </Text>
        <Pressable
          style={({ pressed }) => [
            psStyles.stepArrow,
            psStyles.stepArrowNext,
            pressed && psStyles.stepArrowPressed,
            nextDisabled && psStyles.stepArrowOff,
          ]}
          onPress={onNext}
          disabled={nextDisabled}
          accessibilityRole="button"
          accessibilityLabel="下一期"
        >
          <Ionicons name="chevron-forward" size={22} color={nextDisabled ? "#C9CFDA" : "#1A1A1A"} />
        </Pressable>
      </View>
    </View>
  );
}

const psStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  segment: {
    flexDirection: "row",
    position: "relative",
    backgroundColor: "#EEF1F5",
    borderRadius: radius.pill,
    padding: 3,
  },
  segThumb: {
    position: "absolute",
    top: 3,
    bottom: 3,
    left: 3,
    width: SEG_W,
    borderRadius: radius.pill,
    backgroundColor: "#fff",
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  segBtn: { width: SEG_W, height: 28, alignItems: "center", justifyContent: "center", zIndex: 1 },
  segText: { fontSize: 14, fontWeight: "700", color: colors.textMuted },
  segTextOn: { color: colors.primary },
  stepper: { flexDirection: "row", alignItems: "center", gap: 2 },
  stepArrow: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  stepArrowNext: { marginRight: -6 },
  stepArrowPressed: { backgroundColor: "#EEF1F5" },
  stepArrowOff: { opacity: 0.4 },
  stepLabelText: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
    minWidth: 100,
    textAlign: "center",
  },
});

// ---------------------------------------------------------------------------
// Hero 卡（签名元素）：夜色账本 —— 深墨蓝底、白色营业额大数字、金色毛利。
// 右上角：当前时段 = 「今日/本周/本月」金边角标；非当前 = 「返回今日…」可点胶囊
// ---------------------------------------------------------------------------

export function HeroCard({
  revenue,
  profit,
  orders,
  quantity,
  periodTag, // "今日" | "本周" | "本月"
  isCurrent, // 是否正处当前时段
  onBackToCurrent,
}: {
  revenue: number;
  profit: number;
  orders: number;
  quantity: number;
  periodTag: string;
  isCurrent: boolean;
  onBackToCurrent: () => void;
}) {
  const margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;
  return (
    <View style={heroStyles.card}>
      {/* 无渐变库：用两层半透明圆做柔和光晕层次 */}
      <View style={heroStyles.glowGold} />
      <View style={heroStyles.glowBlue} />
      <View style={heroStyles.labelRow}>
        <Text style={heroStyles.label}>营业额</Text>
        {isCurrent ? (
          <View style={heroStyles.tagNow}>
            <Text style={heroStyles.tagNowText}>{periodTag}</Text>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [heroStyles.tagBack, pressed && heroStyles.tagBackPressed]}
            onPress={onBackToCurrent}
            accessibilityRole="button"
            accessibilityLabel={`返回${periodTag.replace("返回", "")}`}
          >
            <Ionicons name="arrow-undo-outline" size={12} color="#E8D5AB" />
            <Text style={heroStyles.tagBackText}>返回{periodTag}</Text>
          </Pressable>
        )}
      </View>
      <Text style={heroStyles.revenue} allowFontScaling={false} numberOfLines={1}>
        {fmtMoney(revenue)}
      </Text>
      <View style={heroStyles.divider} />
      <View style={heroStyles.statsRow}>
        <View style={heroStyles.stat}>
          <Text style={heroStyles.statLabel}>毛利</Text>
          <Text style={heroStyles.statValueGold} numberOfLines={1} allowFontScaling={false}>
            {yuanStat(profit)}
          </Text>
          <Text style={heroStyles.statSub}>毛利率 {margin}%</Text>
        </View>
        <View style={heroStyles.statSep} />
        <View style={heroStyles.stat}>
          <Text style={heroStyles.statLabel}>订单</Text>
          <View style={heroStyles.valueRow}>
            <Text style={heroStyles.statValue} numberOfLines={1} allowFontScaling={false}>
              {orders}
            </Text>
            <Text style={heroStyles.statUnit}> 单</Text>
          </View>
          <Text style={heroStyles.statSub}> </Text>
        </View>
        <View style={heroStyles.statSep} />
        <View style={heroStyles.stat}>
          <Text style={heroStyles.statLabel}>销量</Text>
          <View style={heroStyles.valueRow}>
            <Text style={heroStyles.statValue} numberOfLines={1} allowFontScaling={false}>
              {quantity}
            </Text>
            <Text style={heroStyles.statUnit}> 件</Text>
          </View>
          <Text style={heroStyles.statSub}> </Text>
        </View>
      </View>
    </View>
  );
}

const heroStyles = StyleSheet.create({
  card: {
    backgroundColor: "#101E3C",
    borderRadius: radius.xl,
    padding: space.xl,
    overflow: "hidden",
  },
  glowGold: {
    position: "absolute",
    top: -70,
    right: -40,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(192,160,101,0.16)",
  },
  glowBlue: {
    position: "absolute",
    bottom: -90,
    left: -50,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(96,141,245,0.14)",
  },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: font.caption, color: "rgba(255,255,255,0.65)", fontWeight: "600" },
  tagNow: {
    paddingHorizontal: 10,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(217,190,138,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  tagNowText: { fontSize: 11, fontWeight: "800", color: "#E8D5AB" },
  tagBack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 10,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: "rgba(217,190,138,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,190,138,0.45)",
  },
  tagBackPressed: { backgroundColor: "rgba(217,190,138,0.3)" },
  tagBackText: { fontSize: 11, fontWeight: "800", color: "#E8D5AB" },
  revenue: { fontSize: 34, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.5, marginTop: 4 },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.10)", marginVertical: space.md },
  statsRow: { flexDirection: "row", alignItems: "flex-start" },
  stat: { flex: 1, gap: 1 },
  statSep: { width: 1, backgroundColor: "rgba(255,255,255,0.10)", marginHorizontal: space.md },
  statLabel: { fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: "600" },
  valueRow: { flexDirection: "row", alignItems: "baseline" },
  statValue: { fontSize: 18, fontWeight: "800", color: "#FFFFFF", marginTop: 2 },
  statValueGold: { fontSize: 18, fontWeight: "800", color: "#D9BE8A", marginTop: 2 },
  statUnit: { fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: "700" },
  statSub: { fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 },
});

// ---------------------------------------------------------------------------
// 员工销售（图例即列表）：头像色圈 + 名字 + 金额 + 占比条。
// 行尾用「单选圈」表达可选中：空圈=可选，实心对勾=筛选中
// ---------------------------------------------------------------------------

export function StaffCard({
  ops,
  totalRevenue,
  activeOperatorId,
  onToggle,
}: {
  ops: OperatorSalesStat[];
  totalRevenue: number;
  activeOperatorId: string | null;
  onToggle: (operatorId: string | null) => void;
}) {
  if (ops.length === 0) return null;
  return (
    <View style={staffStyles.card}>
      <View style={staffStyles.head}>
        <Text style={staffStyles.title}>员工销售</Text>
        <Text style={staffStyles.hint}>点击人名筛选流水</Text>
      </View>
      {ops.map((o) => {
        const oid = o.operatorId ?? "__none__";
        const active = activeOperatorId === oid;
        const share = totalRevenue > 0 ? o.revenue / totalRevenue : 0;
        const palette = operatorColor(o.operatorName ?? "未指定");
        const name = o.operatorName ?? "未指定";
        return (
          <Pressable
            key={oid}
            style={({ pressed }) => [
              staffStyles.row,
              active && staffStyles.rowActive,
              pressed && staffStyles.rowPressed,
            ]}
            onPress={() => onToggle(active ? null : oid)}
            accessibilityRole="button"
            accessibilityLabel={`筛选 ${name} 的流水`}
          >
            <View style={[staffStyles.avatar, { backgroundColor: palette }]}>
              <Text style={staffStyles.avatarText}>{name.slice(0, 1)}</Text>
            </View>
            <View style={staffStyles.info}>
              <Text style={[staffStyles.name, active && { color: palette }]} numberOfLines={1}>
                {name}
              </Text>
              <Text style={staffStyles.meta}>
                {o.orders} 单 · {o.quantity} 件 · 占比 {Math.round(share * 100)}%
              </Text>
              <View style={staffStyles.track}>
                <View
                  style={[
                    staffStyles.fill,
                    { backgroundColor: palette, width: `${Math.max(2, share * 100)}%` },
                  ]}
                />
              </View>
            </View>
            <Text style={[staffStyles.revenue, { color: palette }]}>{fmtMoney(o.revenue)}</Text>
            <View
              style={[
                staffStyles.radio,
                { borderColor: active ? palette : "#D5DBE4" },
                active && { backgroundColor: palette },
              ]}
            >
              {active ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const staffStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: 4,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: { fontSize: font.body, fontWeight: "800", color: colors.text },
  hint: { fontSize: 11, color: "#A6AEBB" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: radius.md,
  },
  rowActive: { backgroundColor: "#F4F7FE" },
  rowPressed: { backgroundColor: "#F8FAFC" },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  info: { flex: 1, gap: 2, minWidth: 0 },
  name: { fontSize: 15, fontWeight: "700", color: colors.text },
  meta: { fontSize: 11, color: colors.textMuted },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "#EEF1F5",
    marginTop: 3,
    overflow: "hidden",
  },
  fill: { height: 4, borderRadius: 2 },
  revenue: { fontSize: 15, fontWeight: "800" },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
});

// ---------------------------------------------------------------------------
// 竖向柱状图（周视图 7 根）：柱顶营业额数值 + X 轴「月·日」；点击下钻到日视图
// ---------------------------------------------------------------------------

export interface BarDatum {
  date: string; // YYYY-MM-DD
  value: number; // 营业额（分）
  label: string; // 柱下标签 "7·21"
  highlight?: boolean; // 今天
  future?: boolean; // 未来（尚无数据）
}

export function DayBars({
  data,
  onTapBar,
}: {
  data: BarDatum[];
  onTapBar: (date: string) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={barStyles.card}>
      <View style={barStyles.head}>
        <Text style={barStyles.title}>每日营业额</Text>
        <Text style={barStyles.hint}>点击柱子看当天</Text>
      </View>
      <View style={barStyles.plot}>
        {data.map((d) => {
          // 柱高上限 82%，给柱顶数值留出空间
          const h = d.value > 0 ? Math.min(82, Math.max(8, (d.value / max) * 82)) : 0;
          return (
            <Pressable
              key={d.date}
              style={({ pressed }) => [barStyles.barCol, pressed && barStyles.barColPressed]}
              onPress={() => onTapBar(d.date)}
              accessibilityRole="button"
              accessibilityLabel={`${d.date} 营业额 ${fmtMoney(d.value)}`}
            >
              <View style={barStyles.barArea}>
                {d.future ? (
                  <View style={barStyles.barGhost} />
                ) : (
                  <View
                    style={[barStyles.bar, { height: `${h}%` }, d.highlight && barStyles.barHi]}
                  />
                )}
                {!d.future && d.value > 0 ? (
                  <View style={[barStyles.valueTip, { bottom: `${h}%` }]}>
                    {d.highlight ? <View style={barStyles.todayDot} /> : null}
                    <Text
                      style={[barStyles.barValue, d.highlight && barStyles.barValueHi]}
                      numberOfLines={1}
                      allowFontScaling={false}
                    >
                      {fmtBarValue(d.value)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={[barStyles.barLabel, d.highlight && barStyles.barLabelHi]}
                numberOfLines={1}
                ellipsizeMode="clip"
              >
                {d.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const barStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: font.body, fontWeight: "800", color: colors.text },
  hint: { fontSize: 11, color: "#A6AEBB" },
  plot: { flexDirection: "row", alignItems: "flex-end", gap: 1 },
  barCol: { flex: 1, alignItems: "center", gap: 4, borderRadius: 6 },
  barColPressed: { backgroundColor: "#F6F8FC" },
  barArea: { height: 100, width: "100%", justifyContent: "flex-end", alignItems: "center" },
  valueTip: {
    position: "absolute",
    left: 0,
    right: 0,
    marginBottom: 3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  barValue: { fontSize: 9, fontWeight: "700", color: "#8B95A6" },
  barValueHi: { color: colors.primary },
  bar: {
    width: "68%",
    maxWidth: 20,
    borderRadius: 4,
    backgroundColor: "#D9E4FB",
  },
  barHi: { backgroundColor: "#2563EB" },
  todayDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#C0A065",
  },
  barGhost: { width: "68%", maxWidth: 20, height: 3, borderRadius: 2, backgroundColor: "#E8ECF2" },
  barLabel: { fontSize: 9, color: "#A6AEBB", fontWeight: "600", height: 12, lineHeight: 12 },
  barLabelHi: { color: colors.primary, fontWeight: "800" },
});

// ---------------------------------------------------------------------------
// 月视图 · 周表：自然周（周一起）裁剪到月内，点击进入该周完整视图
// ---------------------------------------------------------------------------

export interface WeekRowDatum {
  weekIndex: number; // 0 起
  fromDate: string; // 裁剪后起始（月内）
  toDate: string; // 裁剪后结束（月内）
  weekStart: string; // 自然周周一（跳转用）
  revenue: number;
  orders: number;
  currentWeek?: boolean; // 含今天
}

export function WeekRows({
  data,
  onTapWeek,
}: {
  data: WeekRowDatum[];
  onTapWeek: (weekStart: string) => void;
}) {
  if (data.length === 0) return null;
  return (
    <View style={weekStyles.card}>
      <View style={weekStyles.head}>
        <Text style={weekStyles.title}>周表</Text>
        <Text style={weekStyles.hint}>点击查看该周</Text>
      </View>
      {data.map((w) => (
        <Pressable
          key={w.weekIndex}
          style={({ pressed }) => [
            weekStyles.row,
            w.currentWeek && weekStyles.rowCur,
            pressed && weekStyles.rowPressed,
          ]}
          onPress={() => onTapWeek(w.weekStart)}
          accessibilityRole="button"
          accessibilityLabel={`第${w.weekIndex + 1}周 ${fmtRange(w.fromDate, w.toDate)} 营业额 ${fmtMoney(w.revenue)}`}
        >
          <View style={[weekStyles.bar, w.currentWeek && weekStyles.barOn]} />
          <View style={weekStyles.left}>
            <View style={weekStyles.nameRow}>
              <Text style={weekStyles.name}>第 {w.weekIndex + 1} 周</Text>
              {w.currentWeek ? (
                <View style={weekStyles.curTag}>
                  <Text style={weekStyles.curTagText}>本周</Text>
                </View>
              ) : null}
            </View>
            <Text style={weekStyles.range}>{fmtRange(w.fromDate, w.toDate)}</Text>
          </View>
          <View style={weekStyles.right}>
            <Text style={weekStyles.revenue}>{fmtMoney(w.revenue)}</Text>
            <Text style={weekStyles.meta}>{w.orders} 单</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#C4CBD6" />
        </Pressable>
      ))}
    </View>
  );
}

function fmtRange(from: string, to: string): string {
  const fm = Number(from.split("-")[1]);
  const fd = Number(from.split("-")[2]);
  const tm = Number(to.split("-")[1]);
  const td = Number(to.split("-")[2]);
  if (from === to) return `${fm}·${fd}`;
  return fm === tm ? `${fm}·${fd} - ${td}` : `${fm}·${fd} - ${tm}·${td}`;
}

const weekStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: 2,
  },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  title: { fontSize: font.body, fontWeight: "800", color: colors.text },
  hint: { fontSize: 11, color: "#A6AEBB" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: radius.md,
  },
  rowCur: { backgroundColor: "#F6F9FF" },
  rowPressed: { backgroundColor: "#F1F5FA" },
  bar: { width: 3, height: 30, borderRadius: 2, backgroundColor: "transparent" },
  barOn: { backgroundColor: colors.primary },
  left: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 15, fontWeight: "700", color: colors.text },
  curTag: {
    paddingHorizontal: 7,
    height: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  curTagText: { fontSize: 10, fontWeight: "800", color: colors.primary },
  range: { fontSize: 12, color: colors.textMuted },
  right: { alignItems: "flex-end", gap: 2 },
  revenue: { fontSize: 15, fontWeight: "800", color: colors.primary },
  meta: { fontSize: 11, color: colors.textMuted },
});

// ---------------------------------------------------------------------------
// 流水行：时间 · 件数 · 操作人 → 金额（进入单据详情）
// ---------------------------------------------------------------------------

export function OrderRow({
  order,
  showDate,
  onPress,
}: {
  order: SaleOrderDetail;
  showDate: boolean; // 周视图跨天时显示 "M.D HH:mm"
  onPress: () => void;
}) {
  const time = cnClock(order.createdAt);
  const datePart = `${Number(cnDateKey(order.createdAt).split("-")[1])}.${Number(cnDateKey(order.createdAt).split("-")[2])}`;
  return (
    <Pressable
      style={({ pressed }) => [oStyles.row, pressed && oStyles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`订单 ${fmtMoney(order.totalAmount)}`}
    >
      <View style={oStyles.timeBox}>
        <Text style={oStyles.time}>{showDate ? datePart : ""}</Text>
        <Text style={oStyles.clock}>{time}</Text>
      </View>
      <View style={oStyles.info}>
        <Text style={oStyles.qty}>{order.itemCount} 件</Text>
        <Text style={oStyles.operator} numberOfLines={1}>
          {order.operatorName ?? "未指定"}
        </Text>
      </View>
      <Text style={oStyles.amount}>{fmtMoney(order.totalAmount)}</Text>
      <Ionicons name="chevron-forward" size={15} color="#C4CBD6" />
    </Pressable>
  );
}

const oStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: 12,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: { backgroundColor: "#F8FAFC" },
  timeBox: { width: 52, gap: 1 },
  time: { fontSize: 10, color: "#A6AEBB", fontWeight: "600" },
  clock: { fontSize: 15, fontWeight: "700", color: colors.text },
  info: { flex: 1, gap: 1, minWidth: 0 },
  qty: { fontSize: 13, color: "#374151", fontWeight: "600" },
  operator: { fontSize: 11, color: colors.textMuted },
  amount: { fontSize: 16, fontWeight: "800", color: colors.primary },
});

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 柱图数据：周内每天一根柱，标签 "7·21"；空天补 0、未来置灰 */
export function ordersToBars(
  fromDate: string,
  toDate: string,
  orders: SaleOrderDetail[],
  todayStr: string,
): BarDatum[] {
  const byDate = new Map<string, number>();
  for (const o of orders) {
    const key = cnDateKey(o.createdAt);
    byDate.set(key, (byDate.get(key) ?? 0) + o.totalAmount);
  }
  const out: BarDatum[] = [];
  for (let cur = fromDate; cur <= toDate; cur = addDaysStr(cur, 1)) {
    const fm = Number(cur.split("-")[1]);
    const fd = Number(cur.split("-")[2]);
    out.push({
      date: cur,
      value: byDate.get(cur) ?? 0,
      label: `${fm}·${fd}`,
      highlight: cur === todayStr,
      future: cur > todayStr,
    });
  }
  return out;
}

/**
 * 月视图 · 周表数据：自然周（周一起）口径，与周视图一致。
 * 行区间裁剪到月内（首周可能只有 1~2 天），聚合也只算月内部分——
 * 行里显示的数与该行日期区间严格对应；点进周视图看完整自然周。
 * 只保留历史周与当前周，未来周不显示。
 */
export function monthWeekRows(
  fromDate: string,
  toDate: string,
  orders: SaleOrderDetail[],
  todayStr: string,
): WeekRowDatum[] {
  const rows: WeekRowDatum[] = [];
  let ws = weekStartOfStr(fromDate);
  for (let idx = 0; ws <= toDate; idx++, ws = addDaysStr(ws, 7)) {
    const we = addDaysStr(ws, 6);
    const start = ws < fromDate ? fromDate : ws;
    if (start > todayStr) break; // 本周之后的周还未发生，不显示
    const end = we > toDate ? toDate : we;
    let revenue = 0;
    let count = 0;
    for (const o of orders) {
      const key = cnDateKey(o.createdAt);
      if (key >= start && key <= end) {
        revenue += o.totalAmount;
        count += 1;
      }
    }
    rows.push({
      weekIndex: idx,
      fromDate: start,
      toDate: end,
      weekStart: ws,
      revenue,
      orders: count,
      currentWeek: todayStr >= ws && todayStr <= we,
    });
  }
  return rows;
}

// ---- 北京时间安全的日期工具（与后端同一套 +8 偏移规则） --------------------

export const DAY_MS = 24 * 3_600_000;
const CN_MS = 8 * 3_600_000;

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 订单 ISO 时间 → 北京时间日期键 YYYY-MM-DD */
export function cnDateKey(iso: string): string {
  const d = new Date(new Date(iso).getTime() + CN_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 订单 ISO 时间 → 北京时间 "HH:mm" */
export function cnClock(iso: string): string {
  const d = new Date(new Date(iso).getTime() + CN_MS);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** 今天（北京时间）的 YYYY-MM-DD */
export function cnToday(): string {
  const t = new Date(Date.now() + 8 * 3_600_000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** YYYY-MM-DD 加 n 天（纯字符串/UTC 数学，不受设备时区影响） */
export function addDaysStr(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!) + n * DAY_MS);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** 某天所在周的周一（YYYY-MM-DD） */
export function weekStartOfStr(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0=周日
  const diff = (dow + 6) % 7;
  return addDaysStr(s, -diff);
}

/** 某月最后一天日期号 */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 步进标签（周）："7·21 - 27"，跨月 "7·28 - 8·3" */
export function fmtWeekCompact(from: string, to: string): string {
  const fm = Number(from.split("-")[1]);
  const tm = Number(to.split("-")[1]);
  const fd = Number(from.split("-")[2]);
  const td = Number(to.split("-")[2]);
  return fm === tm ? `${fm}·${fd} - ${td}` : `${fm}·${fd} - ${tm}·${td}`;
}
