import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  DailySalesStat,
  MonthlySalesReport,
  OperatorSalesStat,
  SaleOrderDetail,
  SalesRange,
  SalesReport,
  SalesStat,
} from "@cloth-scan/shared";
import {
  getMonthlySales,
  getSalesByDay,
  getSalesReport,
  listSales,
} from "../api";

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** YYYY-MM-DD → 「M月D日 周X」 */
function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = ["日", "一", "二", "三", "四", "五", "六"][
    new Date(y!, m! - 1, d!).getDay()
  ];
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

type SelMonth = { year: number; month: number };
type TabKey = SalesRange | "history";

const TABS: { key: TabKey; label: string }[] = [
  { key: "today", label: "今日" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "history", label: "历史" },
];

/** 合计卡：营业额 + 毛利（含毛利率）+ 单数/件数 */
function TotalCard({ total }: { total: SalesStat }) {
  const margin =
    total.revenue > 0 ? Math.round((total.profit / total.revenue) * 100) : 0;
  return (
    <View style={styles.totalCard}>
      <View style={styles.totalTop}>
        <View>
          <Text style={styles.totalLabel}>营业额</Text>
          <Text style={styles.totalRevenue}>{yuan(total.revenue)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.totalLabel}>毛利</Text>
          <Text
            style={[
              styles.totalProfit,
              { color: total.profit >= 0 ? "#16a34a" : "#dc2626" },
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

/** 下钻迷你条形图：本周按天、本月按周；空数据也展示 */
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
            <View
              style={[
                styles.barFill,
                { width: `${Math.max(2, (b.revenue / max) * 100)}%` },
              ]}
            />
          </View>
          <View style={styles.barValues}>
            <Text style={styles.barRevenue}>{yuan(b.revenue)}</Text>
            <Text
              style={[
                styles.barProfit,
                { color: b.profit >= 0 ? "#16a34a" : "#dc2626" },
              ]}
            >
              利 {yuan(b.profit)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function SalesScreen({
  onBack,
  onOpenOrder,
}: {
  onBack: () => void;
  onOpenOrder: (id: string) => void;
}) {
  const [tab, setTab] = useState<TabKey>("today");
  const [orders, setOrders] = useState<SaleOrderDetail[]>([]);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [monthly, setMonthly] = useState<MonthlySalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const months = useMemo(() => lastMonths(12), []);
  const [sel, setSel] = useState<SelMonth>(months[0]!);
  const [monthOpen, setMonthOpen] = useState(false);

  // 历史 → 点某天查看当日流水
  const [day, setDay] = useState<string | null>(null);
  const [dayOrders, setDayOrders] = useState<SaleOrderDetail[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  const load = useCallback(
    async (t: TabKey, m: SelMonth) => {
      setLoading(true);
      setError(null);
      try {
        if (t === "history") {
          setMonthly(await getMonthlySales(m.year, m.month));
        } else {
          const [rep, list] = await Promise.all([
            getSalesReport(t),
            listSales(),
          ]);
          setReport(rep);
          setOrders(list);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(tab, sel);
  }, [load, tab, sel]);

  const openDay = useCallback(async (date: string) => {
    setDay(date);
    setDayLoading(true);
    try {
      setDayOrders(await getSalesByDay(date));
    } catch {
      setDayOrders([]);
    } finally {
      setDayLoading(false);
    }
  }, []);

  function switchTab(next: TabKey) {
    setDay(null);
    setTab(next);
  }

  const soldDays = (monthly?.days ?? []).filter((d) => d.orders > 0);

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>销售记录</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => switchTab(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === "history" && day === null ? (
        <Pressable style={styles.monthSelect} onPress={() => setMonthOpen(true)}>
          <Text style={styles.monthSelectText}>
            {sel.year}年{sel.month}月
          </Text>
          <Text style={styles.monthSelectCaret}>▾</Text>
        </Pressable>
      ) : null}

      {/* 历史 → 当日流水明细 */}
      {tab === "history" && day !== null ? (
        <FlatList
          data={dayOrders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View>
              <Pressable style={styles.dayBack} onPress={() => setDay(null)}>
                <Text style={styles.dayBackText}>‹ {sel.month}月明细</Text>
              </Pressable>
              <Text style={styles.dayTitle}>{formatDay(day)}</Text>
              {dayLoading ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}
            </View>
          }
          ListEmptyComponent={
            dayLoading ? null : (
              <Text style={styles.empty}>当日暂无流水</Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable style={styles.orderCard} onPress={() => onOpenOrder(item.id)}>
              <View style={styles.orderLeft}>
                <Text style={styles.orderTime}>{formatClock(item.createdAt)}</Text>
                <Text style={styles.orderMeta}>
                  {item.itemCount} 件
                  {item.operatorName ? ` · ${item.operatorName}` : ""}
                </Text>
              </View>
              <Text style={styles.orderAmount}>{yuan(item.totalAmount)}</Text>
            </Pressable>
          )}
        />
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => load(tab, sel)}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : tab === "history" ? (
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
          ListEmptyComponent={
            <Text style={styles.empty}>该月暂无销售记录</Text>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.dayRow} onPress={() => openDay(item.date)}>
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
                      { color: item.profit >= 0 ? "#16a34a" : "#dc2626" },
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
            <Pressable style={styles.orderCard} onPress={() => onOpenOrder(item.id)}>
              <View style={styles.orderLeft}>
                <Text style={styles.orderTime}>{formatTime(item.createdAt)}</Text>
                <Text style={styles.orderMeta}>
                  {item.itemCount} 件
                  {item.operatorName ? ` · ${item.operatorName}` : ""}
                </Text>
              </View>
              <Text style={styles.orderAmount}>{yuan(item.totalAmount)}</Text>
            </Pressable>
          )}
        />
      )}

      {/* 月份选择 */}
      <Modal
        visible={monthOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMonthOpen(false)}
      >
        <Pressable
          style={styles.monthBackdrop}
          onPress={() => setMonthOpen(false)}
        />
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
                  <Text
                    style={[
                      styles.monthItemText,
                      active && styles.monthItemTextActive,
                    ]}
                  >
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
  container: { flex: 1, backgroundColor: "#fff" },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  back: { color: "#2563eb", fontSize: 16 },
  title: { fontSize: 18, fontWeight: "800", color: "#111" },
  placeholder: { width: 32 },
  tabs: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
  },
  tabActive: { backgroundColor: "#2563eb" },
  tabText: { fontSize: 15, fontWeight: "700", color: "#475569" },
  tabTextActive: { color: "#fff" },
  monthSelect: {
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    backgroundColor: "#f8fafc",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  monthSelectText: { fontSize: 16, fontWeight: "700", color: "#1f2937" },
  monthSelectCaret: { fontSize: 14, color: "#6b7280" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  list: { padding: 12, gap: 10 },
  totalCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#eef2f7",
    marginBottom: 10,
  },
  totalTop: { flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 12, color: "#6b7280" },
  totalRevenue: {
    fontSize: 26,
    fontWeight: "800",
    color: "#2563eb",
    marginTop: 2,
  },
  totalProfit: { fontSize: 20, fontWeight: "800", marginTop: 2 },
  totalMargin: { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  totalMeta: { fontSize: 13, color: "#6b7280", marginTop: 8 },
  opBox: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
    padding: 12,
    marginBottom: 10,
    gap: 6,
  },
  opRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  opName: { flex: 1, fontSize: 14, fontWeight: "600", color: "#111" },
  opRight: { alignItems: "flex-end" },
  opRevenue: { fontSize: 15, fontWeight: "800", color: "#e11d48" },
  opMeta: { fontSize: 11, color: "#9ca3af" },
  chartBox: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111",
    marginBottom: 2,
  },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { width: 44, fontSize: 13, color: "#374151" },
  barTrack: {
    flex: 1,
    height: 14,
    backgroundColor: "#eef2f7",
    borderRadius: 7,
    overflow: "hidden",
  },
  barFill: { height: 14, backgroundColor: "#60a5fa", borderRadius: 7 },
  barValues: { width: 96, alignItems: "flex-end" },
  barRevenue: { fontSize: 12, fontWeight: "700", color: "#111" },
  barProfit: { fontSize: 11 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#374151",
    marginTop: 4,
    marginBottom: 6,
  },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 48 },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  dayDate: { fontSize: 15, fontWeight: "700", color: "#111" },
  dayMeta: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  dayRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  dayRevenue: { fontSize: 16, fontWeight: "800", color: "#e11d48" },
  dayProfit: { fontSize: 12, marginTop: 2 },
  dayCaret: { fontSize: 20, color: "#cbd5e1", fontWeight: "700" },
  dayBack: { paddingVertical: 4, marginBottom: 4 },
  dayBackText: { fontSize: 15, color: "#2563eb", fontWeight: "700" },
  dayTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111",
    marginBottom: 8,
  },
  orderCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  orderLeft: { gap: 2 },
  orderTime: { fontSize: 15, fontWeight: "600", color: "#111" },
  orderMeta: { fontSize: 13, color: "#6b7280" },
  orderAmount: { fontSize: 18, fontWeight: "800", color: "#e11d48" },
  error: { color: "#dc2626" },
  retry: {
    borderWidth: 1,
    borderColor: "#2563eb",
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  retryText: { color: "#2563eb" },
  monthBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  monthSheet: {
    position: "absolute",
    left: 24,
    right: 24,
    top: "18%",
    maxHeight: "64%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
  },
  monthSheetTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111",
    marginBottom: 8,
  },
  monthItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  monthItemActive: { backgroundColor: "#eff6ff" },
  monthItemText: { fontSize: 16, color: "#1f2937", fontWeight: "600" },
  monthItemTextActive: { color: "#2563eb", fontWeight: "800" },
  monthCheck: { fontSize: 16, color: "#2563eb", fontWeight: "800" },
});
