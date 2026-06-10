import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  SaleOrderDetail,
  SalesRange,
  SalesReport,
} from "@cloth-scan/shared";
import { getSalesReport, listSales } from "../api";

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

const RANGES: { key: SalesRange; label: string }[] = [
  { key: "today", label: "今日" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
];

/** 合计卡：营业额 + 毛利（含毛利率）+ 单数/件数 */
function TotalCard({ total }: { total: SalesReport["total"] }) {
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
  const [range, setRange] = useState<SalesRange>("today");
  const [orders, setOrders] = useState<SaleOrderDetail[]>([]);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (r: SalesRange) => {
      setLoading(true);
      setError(null);
      try {
        const [rep, list] = await Promise.all([
          getSalesReport(r),
          listSales(),
        ]);
        setReport(rep);
        setOrders(list);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(range);
  }, [load, range]);

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
        {RANGES.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.tab, range === t.key && styles.tabActive]}
            onPress={() => setRange(t.key)}
          >
            <Text
              style={[styles.tabText, range === t.key && styles.tabTextActive]}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => load(range)}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          onRefresh={() => load(range)}
          refreshing={loading}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View>
              {report ? (
                <>
                  <TotalCard total={report.total} />
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
});
