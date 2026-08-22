import { useCallback, useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth-context";
import { BrandLockup } from "../components/BrandLockup";
import { SyncAction } from "../components/SyncAction";
import { useSync } from "../sync/sync-context";
import { getSalesSummary } from "../api";
import { countFailedOps } from "../db/outbox";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space, touch } from "../theme/tokens";
import { yuan } from "../utils/format";

type HomeNav = NativeStackNavigationProp<RootStackParamList, "Home">;

function Tile({
  icon,
  label,
  onPress,
  width,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  width: number;
}) {
  return (
    <Pressable
      style={[styles.tile, { width }]}
      onPress={onPress}
      android_ripple={{ color: colors.primarySoft }}
    >
      <View style={styles.tileIcon}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

export function HomeScreen() {
  const navigation = useNavigation<HomeNav>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const tileWidth = (windowWidth - space.xl * 2 - 12) / 2;
  const { user, logout } = useAuth();
  const { online, syncing, pendingCount, syncNow } = useSync();
  const isOwner = user?.role === "owner";
  const [today, setToday] = useState<{
    revenue: number;
    orders: number;
  } | null>(null);
  const [failedCount, setFailedCount] = useState(0);

  const loadToday = useCallback(async () => {
    try {
      const s = await getSalesSummary();
      setToday({ revenue: s.today.revenue, orders: s.today.orders });
    } catch {
      // 离线忽略
    }
  }, []);

  useEffect(() => {
    void loadToday();
  }, [loadToday, pendingCount]);

  useFocusEffect(
    useCallback(() => {
      void countFailedOps()
        .then(setFailedCount)
        .catch(() => {
          /* ignore */
        });
    }, []),
  );

  const roleLabel = isOwner ? "老板" : "店员";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <BrandLockup variant="header" />
        <Pressable
          onPress={logout}
          hitSlop={8}
          style={styles.logoutBtn}
          accessibilityRole="button"
          accessibilityLabel="退出"
        >
          <Ionicons name="log-out-outline" size={24} color={colors.text} />
        </Pressable>
      </View>

      {failedCount > 0 ? (
        <Pressable style={styles.failedBanner} onPress={() => navigation.navigate("SyncErrors")}>
          <Text style={styles.failedBannerText}>{failedCount} 笔同步失败</Text>
        </Pressable>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {isOwner ? (
          <Pressable style={styles.todayCard} onPress={() => navigation.navigate("Sales")}>
            <Text style={styles.todayLabel}>今日营业额</Text>
            <Text style={styles.todayRevenue}>{today ? yuan(today.revenue) : "—"}</Text>
            <Text style={styles.todayMeta}>{today ? `${today.orders} 笔` : "—"}</Text>
          </Pressable>
        ) : (
          <View style={styles.todayCard}>
            <Text style={styles.todayLabel}>今日营业额</Text>
            <Text style={styles.todayRevenue}>{today ? yuan(today.revenue) : "—"}</Text>
            <Text style={styles.todayMeta}>{today ? `${today.orders} 笔` : "—"}</Text>
          </View>
        )}

        <Pressable style={styles.primaryBtn} onPress={() => navigation.navigate("Cashier")}>
          <Ionicons name="qr-code-outline" size={22} color="#fff" />
          <Text style={styles.primaryText}>扫码收银</Text>
        </Pressable>

        <View style={styles.grid}>
          <Tile
            icon="add-circle-outline"
            label="商品建档"
            width={tileWidth}
            onPress={() => navigation.navigate("CreateProduct")}
          />
          <Tile
            icon="shirt-outline"
            label="商品列表"
            width={tileWidth}
            onPress={() => navigation.navigate("Products")}
          />
          {isOwner ? (
            <Tile
              icon="bar-chart-outline"
              label="销售报表"
              width={tileWidth}
              onPress={() => navigation.navigate("Sales")}
            />
          ) : null}
          {isOwner ? (
            <Tile
              icon="people-outline"
              label="店员管理"
              width={tileWidth}
              onPress={() => navigation.navigate("Staff")}
            />
          ) : null}
        </View>

        <SyncAction
          syncing={syncing}
          online={online}
          pendingCount={pendingCount}
          onPress={() => void syncNow()}
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <Text style={styles.identity}>
          {user?.name}·{roleLabel}
        </Text>
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
    paddingTop: 6,
    paddingBottom: 12,
    backgroundColor: colors.card,
  },
  logoutBtn: {
    width: touch.minSize,
    height: touch.minSize,
    alignItems: "center",
    justifyContent: "center",
  },
  failedBanner: {
    backgroundColor: "#FFF7ED",
    paddingVertical: 12,
    paddingHorizontal: space.xl,
  },
  failedBannerText: { fontSize: font.body, fontWeight: "600", color: "#C2410C" },
  scroll: { flex: 1 },
  body: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.md,
    gap: space.md,
  },
  todayCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  todayLabel: { fontSize: font.caption, color: colors.textMuted, fontWeight: "500" },
  todayRevenue: {
    fontSize: font.display,
    fontWeight: "700",
    color: colors.primary,
    marginTop: 2,
    letterSpacing: -0.4,
  },
  todayMeta: { fontSize: font.caption, color: colors.textMuted, marginTop: 4, fontWeight: "500" },
  primaryBtn: {
    backgroundColor: colors.primary,
    height: 60,
    borderRadius: radius.lg,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryText: { color: "#fff", fontSize: 20, fontWeight: "700" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  tile: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: 18,
    paddingHorizontal: 14,
    minHeight: 88,
    justifyContent: "center",
    gap: 10,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabel: { fontSize: font.body, fontWeight: "600", color: colors.text },
  footer: {
    alignItems: "center",
    paddingTop: 4,
  },
  identity: {
    fontFamily: Platform.OS === "ios" ? "Songti SC" : "serif",
    fontSize: 15,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },
});
