import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../auth-context";
import { useSync } from "../sync/sync-context";
import { getSalesSummary } from "../api";
import { countFailedOps } from "../db/outbox";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space, touch } from "../theme/tokens";
import { yuan } from "../utils/format";

type HomeNav = NativeStackNavigationProp<RootStackParamList, "Home">;

/** 四宫格入口（图标 + 文字双编码，§2.1 / §3.5）。
 *  target 限定为无必填参数的路由（避免 navigate 时缺参数的 TS 报错）。 */
type HomeEntryTarget = "Cashier" | "Products" | "Sales" | "Staff";
interface HomeEntry {
  icon: string;
  label: string;
  target: HomeEntryTarget;
}

export function HomeScreen() {
  const navigation = useNavigation<HomeNav>();
  const { user, logout } = useAuth();
  const { online, syncing, pendingCount, syncNow } = useSync();
  const isOwner = user?.role === "owner";
  const [today, setToday] = useState<{ revenue: number; orders: number } | null>(null);
  const [failedCount, setFailedCount] = useState(0);

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

  // 进入/返回首页时刷新失败同步计数：从同步异常列表重试/放弃返回后需要更新徽标
  useFocusEffect(
    useCallback(() => {
      void countFailedOps()
        .then(setFailedCount)
        .catch(() => {
          /* 读取失败忽略，不影响主流程 */
        });
    }, []),
  );

  // 入口列表：店员仅显示 2 个大入口（PRD §6），店主 4 个。
  // 注：标签打印入口需先选商品（LabelPrint 路由携带 product 参数），
  // 故首页用"店员管理"作为第 4 入口；标签打印从商品详情进入。
  const ownerEntries: HomeEntry[] = [
    { icon: "📷", label: "扫码收银", target: "Cashier" },
    { icon: "👗", label: "商品管理", target: "Products" },
    { icon: "📊", label: "销售报表", target: "Sales" },
    { icon: "👥", label: "店员管理", target: "Staff" },
  ];
  const staffEntries: HomeEntry[] = [
    { icon: "📷", label: "扫码收银", target: "Cashier" },
    { icon: "👗", label: "商品管理", target: "Products" },
  ];
  const entries = isOwner ? ownerEntries : staffEntries;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.welcome}>
          {user?.name}（{isOwner ? "老板" : "店员"}）
        </Text>
        <Pressable onPress={logout} hitSlop={8} style={styles.logoutBtn}>
          <Text style={styles.logout}>退出</Text>
        </Pressable>
      </View>

      {failedCount > 0 ? (
        <Pressable style={styles.failedBanner} onPress={() => navigation.navigate("SyncErrors")}>
          <Text style={styles.failedBannerText}>⚠️ 有 {failedCount} 笔同步失败，点查看</Text>
        </Pressable>
      ) : null}

      {/* 今日营业额大数字卡（Monzo 风格，§2.2）：店主可见，店员不可见 */}
      {isOwner ? (
        <Pressable
          style={({ pressed }) => [styles.todayCard, pressed && styles.todayCardPressed]}
          onPress={() => navigation.navigate("Sales")}
        >
          <Text style={styles.todayLabel}>今日营业额</Text>
          <Text style={styles.todayRevenue}>{today ? yuan(today.revenue) : "—"}</Text>
          <Text style={styles.todayMeta}>
            {today ? `${today.orders} 单 · 点击查看销售记录` : "点击查看销售记录"}
          </Text>
        </Pressable>
      ) : null}

      {/* 四宫格大入口（Grab 风格，§2.1 / §3.5） */}
      <View style={styles.grid}>
        {entries.map((e) => (
          <Pressable
            key={e.label}
            style={({ pressed }) => [styles.gridCell, pressed && styles.gridCellPressed]}
            onPress={() => navigation.navigate(e.target)}
          >
            <Text style={styles.gridIcon}>{e.icon}</Text>
            <Text style={styles.gridLabel}>{e.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* 底部同步状态 */}
      <View style={styles.syncBox}>
        <Pressable
          style={({ pressed }) => [styles.syncBtn, pressed && styles.syncBtnPressed]}
          onPress={() => void syncNow()}
        >
          <Text style={styles.syncBtnText}>{syncing ? "同步中…" : "立即同步"}</Text>
        </Pressable>
        <View style={styles.syncRow}>
          <Text style={[styles.dot, online ? styles.online : styles.offline]}>●</Text>
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
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  welcome: { fontSize: font.body, fontWeight: "600", color: colors.text },
  logoutBtn: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    minHeight: touch.minSize,
    justifyContent: "center",
  },
  logout: { fontSize: font.body, color: colors.danger, fontWeight: "700" },

  // 失败同步横幅（Task 2）：保留功能、统一为设计语言配色
  failedBanner: {
    backgroundColor: colors.dangerSoft,
    borderBottomWidth: 1,
    borderBottomColor: "#FECACA",
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    minHeight: touch.minSize,
    justifyContent: "center",
  },
  failedBannerText: { fontSize: font.body, fontWeight: "700", color: "#B45309" },

  // 今日营业额大数字卡（Monzo §2.2）：display 36sp、墨绿品牌色
  todayCard: {
    marginHorizontal: space.lg,
    marginTop: space.sm,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  todayCardPressed: { opacity: 0.85 },
  todayLabel: { fontSize: font.caption, color: colors.textMuted, fontWeight: "600" },
  todayRevenue: {
    fontSize: font.display,
    fontWeight: "800",
    color: colors.primary,
    marginTop: space.xs,
  },
  todayMeta: { fontSize: font.caption, color: colors.textMuted, marginTop: space.xs },

  // 四宫格大入口（Grab §2.1）
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.md,
    padding: space.lg,
    justifyContent: "space-between",
  },
  gridCell: {
    width: "48%",
    aspectRatio: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gridCellPressed: { backgroundColor: colors.primarySoft, opacity: 0.9 },
  gridIcon: { fontSize: 44 },
  gridLabel: { fontSize: font.title, fontWeight: "800", color: colors.text },

  // 底部同步区
  syncBox: { padding: space.lg, gap: space.md, marginTop: "auto" },
  syncBtn: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: "center",
    minHeight: touch.minSize,
    justifyContent: "center",
  },
  syncBtnPressed: { backgroundColor: "#D6E6DC" },
  syncBtnText: { color: colors.primary, fontSize: font.body, fontWeight: "800" },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" },
  dot: { fontSize: 12 },
  online: { color: colors.online },
  offline: { color: colors.warn },
  syncText: { fontSize: font.caption, color: colors.textMuted },
});
