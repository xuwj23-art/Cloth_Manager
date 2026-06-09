import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { SaleOrderDetail, SalesSummary } from "@cloth-scan/shared";
import { getSalesSummary, listSales } from "../api";

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

function StatCard({
  label,
  stats,
}: {
  label: string;
  stats: { revenue: number; orders: number; quantity: number };
}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statRevenue}>{yuan(stats.revenue)}</Text>
      <Text style={styles.statMeta}>
        {stats.orders} 单 · {stats.quantity} 件
      </Text>
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
  const [orders, setOrders] = useState<SaleOrderDetail[]>([]);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, list] = await Promise.all([getSalesSummary(), listSales()]);
      setSummary(s);
      setOrders(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>销售记录</Text>
        <View style={styles.placeholder} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={load}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          onRefresh={load}
          refreshing={loading}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View>
              {summary ? (
                <>
                  <View style={styles.statRow}>
                    <StatCard label="今日" stats={summary.today} />
                    <StatCard label="本周" stats={summary.week} />
                  </View>
                  {summary.topSkus.length > 0 ? (
                    <View style={styles.topBox}>
                      <Text style={styles.topTitle}>近 7 天热销 TOP</Text>
                      {summary.topSkus.map((t, i) => (
                        <View key={t.skuId} style={styles.topRow}>
                          <Text style={styles.topRank}>{i + 1}</Text>
                          <Text style={styles.topName} numberOfLines={1}>
                            {t.productName} {t.color}/{t.size}
                          </Text>
                          <Text style={styles.topQty}>{t.quantity} 件</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
              <Text style={styles.sectionTitle}>流水（最近 100 笔）</Text>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  list: { padding: 12, gap: 10 },
  statRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  statCard: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  statLabel: { fontSize: 13, color: "#6b7280" },
  statRevenue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#2563eb",
    marginTop: 4,
  },
  statMeta: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  topBox: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
    padding: 12,
    marginBottom: 10,
    gap: 6,
  },
  topTitle: { fontSize: 14, fontWeight: "700", color: "#111", marginBottom: 2 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  topRank: {
    width: 20,
    textAlign: "center",
    fontWeight: "800",
    color: "#f59e0b",
  },
  topName: { flex: 1, fontSize: 14, color: "#374151" },
  topQty: { fontSize: 13, color: "#6b7280" },
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
