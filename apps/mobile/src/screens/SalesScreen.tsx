import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type {
  DailySalesStat,
  MonthlySalesReport,
  OperatorSalesStat,
  SaleOrderDetail,
  SalesRange,
  SalesReport,
  SalesStat,
} from "@cloth-scan/shared";
import { getMonthlySales, getSalesByDay, getSalesReport, listSales } from "../api";
import { StateView } from "../components/StateView";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space, touch } from "../theme/tokens";
import { yuan } from "../utils/format";

type SalesNav = NativeStackNavigationProp<RootStackParamList, "Sales">;

/** 月报列表用：不含年份（月份由分组标题给出），仅 "MM-DD HH:mm" */
function formatTimeNoYear(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 日列表用：仅 "HH:mm" */
function formatClock(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** YYYY-MM-DD → 「M月D日 周X」 */
function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = ["日", "一", "二", "三", "四", "五", "六"][new Date(y!, m! - 1, d!).getDay()];
  return `${m}月${d}日 周${wd}`;
}

/** 最近 n 个月（含当月），当月在最前 */
function lastMonths(n: number): { year: number; month: number }[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
}

export type SalesMonth = { year: number; month: number };
export type SalesTab = SalesRange | "history";
type SelMonth = SalesMonth;
type TabKey = SalesTab;

const TABS: { key: TabKey; label: string }[] = [
  { key: "today", label: "今日" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "history", label: "历史" },
];

/** 合计卡（Monzo §2.2）：营业额大数字 + 毛利（含毛利率）+ 单数/件数 */
function TotalCard({ total }: { total: SalesStat }) {
  const margin = total.revenue > 0 ? Math.round((total.profit / total.revenue) * 100) : 0;
  return (
    <View style={styles.totalCard}>
      <View style={styles.totalTop}>
        <View style={styles.totalCol}>
          <Text style={styles.totalLabel}>营业额</Text>
          <Text style={styles.totalRevenue}>{yuan(total.revenue)}</Text>
        </View>
        <View style={[styles.totalCol, { alignItems: "flex-end" }]}>
          <Text style={styles.totalLabel}>毛利</Text>
          <Text
            style={[
              styles.totalProfit,
              { color: total.profit >= 0 ? colors.online : colors.danger },
            ]}
          >
            {yuan(total.profit)}
          </Text>
          <Text style={styles.totalMargin}>毛利率 {margin}%</Text>
        </View>
      </View>
      <Text style={styles.totalMeta}>
        {total.orders} 单 · {total.quantity} 件
      </Text>
    </View>
  );
}

/** 店员销售额：按营业额从高到低 */
function OperatorCard({ ops }: { ops: OperatorSalesStat[] }) {
  if (!ops || ops.length === 0) return null;
  return (
    <View style={styles.opBox}>
      <Text style={styles.chartTitle}>店员销售额</Text>
      {ops.map((o) => (
        <View key={o.operatorId ?? "__none__"} style={styles.opRow}>
          <Text style={styles.opName} numberOfLines={1}>
            {o.operatorName ?? "未指定 / 已删除"}
          </Text>
          <View style={styles.opRight}>
            <Text style={styles.opRevenue}>{yuan(o.revenue)}</Text>
            <Text style={styles.opMeta}>
              {o.orders}单 · {o.quantity}件
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** 下钻迷你条形图：本周按天、本月按周；空数据也展示（§3.6 粗柱 + 数值标签） */
function BucketChart({ report }: { report: SalesReport }) {
  if (report.buckets.length === 0) return null;
  const max = Math.max(1, ...report.buckets.map((b) => b.revenue));
  const title = report.range === "week" ? "每日营业额" : "每周营业额";
  return (
    <View style={styles.chartBox}>
      <Text style={styles.chartTitle}>{title}</Text>
      {report.buckets.map((b) => (
        <View key={b.key} style={styles.barRow}>
          <Text style={styles.barLabel}>{b.label}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.max(2, (b.revenue / max) * 100)}%` }]} />
          </View>
          <View style={styles.barValues}>
            <Text style={styles.barRevenue}>{yuan(b.revenue)}</Text>
            <Text
              style={[styles.barProfit, { color: b.profit >= 0 ? colors.online : colors.danger }]}
            >
              利 {yuan(b.profit)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function SalesScreen() {
  const navigation = useNavigation<SalesNav>();
  const [tab, setTab] = useState<SalesTab>("today");
  const [sel, setSel] = useState<SalesMonth>(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [day, setDay] = useState<string | null>(null);

  const [orders, setOrders] = useState<SaleOrderDetail[]>([]);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [monthly, setMonthly] = useState<MonthlySalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const months = useMemo(() => lastMonths(12), []);
  const [monthOpen, setMonthOpen] = useState(false);

  // 历史 → 点某天查看当日流水
  const [dayOrders, setDayOrders] = useState<SaleOrderDetail[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  const load = useCallback(async (t: TabKey, m: SelMonth) => {
    setLoading(true);
    setError(null);
    try {
      if (t === "history") {
        setMonthly(await getMonthlySales(m.year, m.month));
      } else {
        const [rep, list] = await Promise.all([getSalesReport(t), listSales()]);
        setReport(rep);
        setOrders(list);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // 切 tab/月份时重载
  useEffect(() => {
    void load(tab, sel);
  }, [load, tab, sel]);

  // 返回本屏时自动刷新（替代原 salesRefreshKey 机制）：
  // 从单据详情编辑/删除后返回，列表与报表会重新拉取最新数据。
  useFocusEffect(
    useCallback(() => {
      void load(tab, sel);
    }, [load, tab, sel]),
  );

  // 当日流水：day 变化（含返回后重建）时按需加载
  useEffect(() => {
    if (tab !== "history" || day === null) {
      setDayOrders([]);
      return;
    }
    let alive = true;
    setDayLoading(true);
    getSalesByDay(day)
      .then((d) => alive && setDayOrders(d))
      .catch(() => alive && setDayOrders([]))
      .finally(() => alive && setDayLoading(false));
    return () => {
      alive = false;
    };
  }, [tab, day]);

  function switchTab(next: TabKey) {
    setDay(null);
    setTab(next);
  }

  const soldDays = (monthly?.days ?? []).filter((d) => d.orders > 0);

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.topbarBtn}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>销售记录</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            style={({ pressed }) => [
              styles.tab,
              tab === t.key && styles.tabActive,
              pressed && tab === t.key && styles.tabActivePressed,
            ]}
            onPress={() => switchTab(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "history" && day === null ? (
        <Pressable
          style={({ pressed }) => [styles.monthSelect, pressed && styles.monthSelectPressed]}
          onPress={() => setMonthOpen(true)}
        >
          <Text style={styles.monthSelectText}>
            {sel.year}年{sel.month}月
          </Text>
          <Text style={styles.monthSelectCaret}>▾</Text>
        </Pressable>
      ) : null}

      {/* 历史 → 当日流水明细（带返回上一级的导航） */}
      {tab === "history" && day !== null ? (
        <FlatList
          data={dayOrders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View>
              <Pressable style={styles.dayBack} onPress={() => setDay(null)} hitSlop={8}>
                <Text style={styles.dayBackText}>‹ {sel.month}月明细</Text>
              </Pressable>
              <Text style={styles.dayTitle}>{formatDay(day)}</Text>
            </View>
          }
          ListEmptyComponent={dayLoading ? null : <Text style={styles.empty}>当日暂无流水</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.orderCard, pressed && styles.cardPressed]}
              onPress={() => navigation.navigate("SaleDetail", { orderId: item.id })}
            >
              <View style={styles.orderLeft}>
                <Text style={styles.orderTime}>{formatClock(item.createdAt)}</Text>
                <Text style={styles.orderMeta}>
                  {item.itemCount} 件{item.operatorName ? ` · ${item.operatorName}` : ""}
                </Text>
              </View>
              <Text style={styles.orderAmount}>{yuan(item.totalAmount)}</Text>
            </Pressable>
          )}
        />
      ) : (
        <StateView loading={loading} error={error} onRetry={() => load(tab, sel)}>
          {tab === "history" ? (
            <FlatList<DailySalesStat>
              data={soldDays}
              keyExtractor={(d) => d.date}
              onRefresh={() => load(tab, sel)}
              refreshing={loading}
              contentContainerStyle={styles.list}
              ListHeaderComponent={
                monthly ? (
                  <View>
                    <TotalCard total={monthly.total} />
                    <OperatorCard ops={monthly.byOperator} />
                    <Text style={styles.sectionTitle}>每日明细</Text>
                  </View>
                ) : null
              }
              ListEmptyComponent={<Text style={styles.empty}>该月暂无销售记录</Text>}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [styles.dayRow, pressed && styles.cardPressed]}
                  onPress={() => setDay(item.date)}
                >
                  <View>
                    <Text style={styles.dayDate}>{formatDay(item.date)}</Text>
                    <Text style={styles.dayMeta}>
                      {item.orders} 单 · {item.quantity} 件
                    </Text>
                  </View>
                  <View style={styles.dayRight}>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.dayRevenue}>{yuan(item.revenue)}</Text>
                      <Text
                        style={[
                          styles.dayProfit,
                          { color: item.profit >= 0 ? colors.online : colors.danger },
                        ]}
                      >
                        利 {yuan(item.profit)}
                      </Text>
                    </View>
                    <Text style={styles.dayCaret}>›</Text>
                  </View>
                </Pressable>
              )}
            />
          ) : (
            <FlatList
              data={orders}
              keyExtractor={(o) => o.id}
              onRefresh={() => load(tab, sel)}
              refreshing={loading}
              contentContainerStyle={styles.list}
              ListHeaderComponent={
                <View>
                  {report ? (
                    <>
                      <TotalCard total={report.total} />
                      <OperatorCard ops={report.byOperator} />
                      <BucketChart report={report} />
                    </>
                  ) : null}
                  <Text style={styles.sectionTitle}>流水（最近 500 笔）</Text>
                </View>
              }
              ListEmptyComponent={
                <Text style={styles.empty}>还没有销售记录，去「扫码收银」开张吧</Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [styles.orderCard, pressed && styles.cardPressed]}
                  onPress={() => navigation.navigate("SaleDetail", { orderId: item.id })}
                >
                  <View style={styles.orderLeft}>
                    <Text style={styles.orderTime}>{formatTimeNoYear(item.createdAt)}</Text>
                    <Text style={styles.orderMeta}>
                      {item.itemCount} 件{item.operatorName ? ` · ${item.operatorName}` : ""}
                    </Text>
                  </View>
                  <Text style={styles.orderAmount}>{yuan(item.totalAmount)}</Text>
                </Pressable>
              )}
            />
          )}
        </StateView>
      )}

      {/* 月份选择（Modal） */}
      <Modal
        visible={monthOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMonthOpen(false)}
      >
        <Pressable style={styles.monthBackdrop} onPress={() => setMonthOpen(false)} />
        <View style={styles.monthSheet}>
          <Text style={styles.monthSheetTitle}>选择月份</Text>
          <FlatList
            data={months}
            keyExtractor={(m) => `${m.year}-${m.month}`}
            renderItem={({ item }) => {
              const active = item.year === sel.year && item.month === sel.month;
              return (
                <Pressable
                  style={[styles.monthItem, active && styles.monthItemActive]}
                  onPress={() => {
                    setSel(item);
                    setDay(null);
                    setMonthOpen(false);
                  }}
                >
                  <Text style={[styles.monthItemText, active && styles.monthItemTextActive]}>
                    {item.year}年{item.month}月
                  </Text>
                  {active ? <Text style={styles.monthCheck}>✓</Text> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topbarBtn: { minHeight: touch.minSize, justifyContent: "center" },
  back: { color: colors.primary, fontSize: font.body },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  placeholder: { width: 32 },
  tabs: {
    flexDirection: "row",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  tab: {
    flex: 1,
    paddingVertical: space.md - 2,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    minHeight: touch.minSize,
    justifyContent: "center",
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabActivePressed: { backgroundColor: colors.primaryPressed },
  tabText: { fontSize: font.body, fontWeight: "700", color: colors.textMuted },
  tabTextActive: { color: "#fff" },
  monthSelect: {
    marginHorizontal: space.md,
    marginBottom: space.xs,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: touch.minSize,
  },
  monthSelectPressed: { opacity: 0.85 },
  monthSelectText: { fontSize: font.body, fontWeight: "700", color: colors.text },
  monthSelectCaret: { fontSize: font.caption, color: colors.textMuted },
  list: { padding: space.md, gap: space.md },
  // 大数字卡（Monzo §2.2）：营业额 display 字号 + 墨绿品牌色
  totalCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.md,
  },
  totalTop: { flexDirection: "row", justifyContent: "space-between" },
  totalCol: { gap: 2 },
  totalLabel: { fontSize: font.caption, color: colors.textMuted, fontWeight: "600" },
  totalRevenue: {
    fontSize: font.display,
    fontWeight: "800",
    color: colors.primary,
    marginTop: space.xs,
  },
  totalProfit: { fontSize: font.title + 2, fontWeight: "800", marginTop: space.xs },
  totalMargin: { fontSize: font.caption - 2, color: colors.textMuted, marginTop: 2 },
  totalMeta: { fontSize: font.caption, color: colors.textMuted, marginTop: space.sm },
  opBox: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    marginBottom: space.md,
    gap: space.sm,
  },
  opRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  opName: { flex: 1, fontSize: font.body, fontWeight: "600", color: colors.text },
  opRight: { alignItems: "flex-end" },
  opRevenue: { fontSize: font.body, fontWeight: "800", color: colors.primary },
  opMeta: { fontSize: font.caption - 2, color: colors.textMuted },
  chartBox: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    marginBottom: space.md,
    gap: space.sm,
  },
  chartTitle: { fontSize: font.body, fontWeight: "700", color: colors.text, marginBottom: 2 },
  barRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  barLabel: { width: 44, fontSize: font.caption, color: colors.text },
  barTrack: {
    flex: 1,
    height: 16,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  barFill: { height: 16, backgroundColor: colors.primary, borderRadius: radius.sm },
  barValues: { width: 100, alignItems: "flex-end" },
  barRevenue: { fontSize: font.caption - 2, fontWeight: "700", color: colors.text },
  barProfit: { fontSize: font.caption - 3 },
  sectionTitle: {
    fontSize: font.body,
    fontWeight: "700",
    color: colors.text,
    marginTop: space.xs,
    marginBottom: space.xs,
  },
  empty: {
    textAlign: "center",
    color: colors.textMuted,
    marginTop: space.xxl * 2,
    fontSize: font.body,
  },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayDate: { fontSize: font.body, fontWeight: "700", color: colors.text },
  dayMeta: { fontSize: font.caption, color: colors.textMuted, marginTop: 2 },
  dayRight: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dayRevenue: { fontSize: font.body, fontWeight: "800", color: colors.primary },
  dayProfit: { fontSize: font.caption, marginTop: 2 },
  dayCaret: { fontSize: font.title + 2, color: colors.border, fontWeight: "700" },
  dayBack: {
    paddingVertical: space.xs,
    marginBottom: space.xs,
    minHeight: touch.minSize,
    justifyContent: "center",
  },
  dayBackText: { fontSize: font.body, color: colors.primary, fontWeight: "700" },
  dayTitle: {
    fontSize: font.title,
    fontWeight: "800",
    color: colors.text,
    marginBottom: space.sm,
  },
  orderCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPressed: { opacity: 0.85 },
  orderLeft: { gap: 2, flex: 1 },
  orderTime: { fontSize: font.body, fontWeight: "600", color: colors.text },
  orderMeta: { fontSize: font.caption, color: colors.textMuted },
  orderAmount: { fontSize: font.title, fontWeight: "800", color: colors.primary },
  // 月份选择 Modal
  monthBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.backdrop },
  monthSheet: {
    position: "absolute",
    left: space.xl,
    right: space.xl,
    top: "18%",
    maxHeight: "64%",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  monthSheetTitle: {
    fontSize: font.body,
    fontWeight: "800",
    color: colors.text,
    marginBottom: space.sm,
  },
  monthItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space.md + 1,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    minHeight: touch.minSize,
  },
  monthItemActive: { backgroundColor: colors.primarySoft },
  monthItemText: { fontSize: font.body, color: colors.text, fontWeight: "600" },
  monthItemTextActive: { color: colors.primary, fontWeight: "800" },
  monthCheck: { fontSize: font.body, color: colors.primary, fontWeight: "800" },
});
