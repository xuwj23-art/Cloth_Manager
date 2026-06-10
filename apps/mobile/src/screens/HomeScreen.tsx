import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../auth-context";
import { useSync } from "../sync/sync-context";
import { getSalesSummary } from "../api";

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export function HomeScreen({
  onScan,
  onProducts,
  onCreate,
  onSales,
  onStaff,
}: {
  onScan: () => void;
  onProducts: () => void;
  onCreate: () => void;
  onSales: () => void;
  onStaff: () => void;
}) {
  const { user, logout } = useAuth();
  const { online, syncing, pendingCount, syncNow } = useSync();
  const isOwner = user?.role === "owner";
  const [today, setToday] = useState<{
    revenue: number;
    orders: number;
  } | null>(null);

  const loadToday = useCallback(async () => {
    if (!isOwner) return; // 报表为店主专属，店员不请求
    try {
      const s = await getSalesSummary();
      setToday({ revenue: s.today.revenue, orders: s.today.orders });
    } catch {
      // 离线或未登录态忽略，不影响主流程
    }
  }, [isOwner]);

  // 进入首页时刷新今日数据；结算后 pendingCount 变化也会触发刷新
  useEffect(() => {
    void loadToday();
  }, [loadToday, pendingCount]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.welcome}>
          {user?.name}（{user?.role === "owner" ? "老板" : "店员"}）
        </Text>
        <Pressable onPress={logout}>
          <Text style={styles.logout}>退出</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>服装进销存</Text>
        <Text style={styles.subtitle}>扫吊牌二维码，秒匹配商品</Text>

        {isOwner ? (
          <Pressable style={styles.todayCard} onPress={onSales}>
            <Text style={styles.todayLabel}>今日营业额</Text>
            <Text style={styles.todayRevenue}>
              {today ? yuan(today.revenue) : "—"}
            </Text>
            <Text style={styles.todayMeta}>
              {today
                ? `${today.orders} 单 · 点击查看销售记录`
                : "点击查看销售记录"}
            </Text>
          </Pressable>
        ) : null}

        <Pressable style={styles.primaryBtn} onPress={onScan}>
          <Text style={styles.primaryText}>扫码收银</Text>
        </Pressable>

        <View style={styles.row}>
          {isOwner ? (
            <Pressable
              style={[styles.secondaryBtn, styles.flex1]}
              onPress={onCreate}
            >
              <Text style={styles.secondaryText}>商品建档</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.secondaryBtn, styles.flex1]}
            onPress={onProducts}
          >
            <Text style={styles.secondaryText}>商品列表</Text>
          </Pressable>
        </View>

        {isOwner ? (
          <>
            <Pressable
              style={[styles.secondaryBtn, styles.fullWidth]}
              onPress={onSales}
            >
              <Text style={styles.secondaryText}>销售记录 / 报表</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, styles.fullWidth]}
              onPress={onStaff}
            >
              <Text style={styles.secondaryText}>店员管理</Text>
            </Pressable>
          </>
        ) : null}

        <Pressable style={styles.linkBtn} onPress={() => void syncNow()}>
          <Text style={styles.linkText}>{syncing ? "同步中…" : "立即同步"}</Text>
        </Pressable>

        <View style={styles.syncRow}>
          <Text style={[styles.dot, online ? styles.online : styles.offline]}>
            ●
          </Text>
          <Text style={styles.syncText}>
            {online ? "在线" : "离线"}
            {pendingCount > 0 ? ` · ${pendingCount} 笔待同步` : " · 已全部同步"}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  welcome: { fontSize: 16, fontWeight: "600", color: "#111" },
  logout: { fontSize: 15, color: "#dc2626" },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  title: { fontSize: 32, fontWeight: "800", color: "#111" },
  subtitle: { fontSize: 16, color: "#666", marginBottom: 24 },
  primaryBtn: {
    backgroundColor: "#2563eb",
    paddingVertical: 20,
    paddingHorizontal: 48,
    borderRadius: 16,
    width: "100%",
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontSize: 22, fontWeight: "800" },
  secondaryBtn: {
    borderWidth: 1.5,
    borderColor: "#2563eb",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: "100%",
    alignItems: "center",
  },
  secondaryText: { color: "#2563eb", fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", gap: 12, width: "100%" },
  flex1: { flex: 1 },
  fullWidth: { width: "100%" },
  todayCard: {
    width: "100%",
    backgroundColor: "#eff6ff",
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "#dbeafe",
    marginBottom: 4,
  },
  todayLabel: { fontSize: 14, color: "#2563eb" },
  todayRevenue: {
    fontSize: 30,
    fontWeight: "800",
    color: "#1d4ed8",
    marginTop: 4,
  },
  todayMeta: { fontSize: 13, color: "#60a5fa", marginTop: 2 },
  linkBtn: { paddingVertical: 8 },
  linkText: { color: "#2563eb", fontSize: 15, fontWeight: "600" },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { fontSize: 12 },
  online: { color: "#16a34a" },
  offline: { color: "#f59e0b" },
  syncText: { fontSize: 13, color: "#6b7280" },
});
