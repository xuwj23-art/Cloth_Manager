import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
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

/**
 * 底部同步胶囊：已同步(绿对勾)/同步中(旋转)/离线/待同步(琥珀)，点击立即同步
 */
function SyncChip({
  online,
  syncing,
  pendingCount,
  onPress,
}: {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  onPress: () => void;
}) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!syncing) {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [syncing, spin]);

  let icon: keyof typeof Ionicons.glyphMap = "checkmark-circle";
  let color = "#0EA472";
  let label = "已同步";
  if (syncing) {
    icon = "sync";
    color = colors.primary;
    label = "同步中";
  } else if (!online) {
    icon = "cloud-offline-outline";
    color = "#94A3B8";
    label = "离线";
  } else if (pendingCount > 0) {
    icon = "cloud-upload-outline";
    color = "#D97706";
    label = `${pendingCount} 笔待同步`;
  }

  return (
    <Pressable
      style={({ pressed }) => [footStyles.chip, pressed && footStyles.chipPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}，点击立即同步`}
    >
      {syncing ? (
        <Animated.View
          style={{
            transform: [
              { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
            ],
          }}
        >
          <Ionicons name={icon} size={13} color={color} />
        </Animated.View>
      ) : (
        <Ionicons name={icon} size={13} color={color} />
      )}
      <Text style={[footStyles.chipText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const footStyles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: "#F1F4F8",
  },
  chipPressed: { backgroundColor: "#E6EBF2" },
  chipText: { fontSize: 12, fontWeight: "700" },
});

export function HomeScreen() {
  const navigation = useNavigation<HomeNav>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const tileWidth = (windowWidth - space.xl * 2 - 12) / 2;
  const { user } = useAuth();
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
      void loadToday();
      void countFailedOps()
        .then(setFailedCount)
        .catch(() => {
          /* ignore */
        });
    }, [loadToday]),
  );

  const roleLabel = isOwner ? "老板" : "店员";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <BrandLockup variant="header" />
        <Pressable
          onPress={() => navigation.navigate("Settings")}
          hitSlop={8}
          style={styles.logoutBtn}
          accessibilityRole="button"
          accessibilityLabel="设置"
        >
          <Ionicons name="settings-outline" size={24} color={colors.text} />
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
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {user?.shopName ? (
          <View style={styles.shopLine}>
            <Ionicons name="storefront-outline" size={13} color="#C0A065" />
            <Text style={styles.shopLineText} numberOfLines={1}>
              {user.shopName}
            </Text>
          </View>
        ) : null}
        <View style={styles.footCard}>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(user?.name ?? "?").slice(0, 1)}</Text>
            </View>
            <View style={styles.idCol}>
              <Text style={styles.userName} numberOfLines={1}>
                {user?.name ?? "未登录"}
              </Text>
              <View
                style={[styles.rolePill, isOwner ? styles.rolePillOwner : styles.rolePillStaff]}
              >
                <Text
                  style={[
                    styles.rolePillText,
                    isOwner ? styles.rolePillTextOwner : styles.rolePillTextStaff,
                  ]}
                >
                  {roleLabel}
                </Text>
              </View>
            </View>
          </View>
          <SyncChip
            online={online}
            syncing={syncing}
            pendingCount={pendingCount}
            onPress={() => void syncNow()}
          />
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
  footer: { paddingTop: 6, gap: 8 },
  shopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: space.xl,
  },
  shopLineText: { fontSize: 13, fontWeight: "600", color: "#8B95A6", letterSpacing: 1 },
  footCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: space.xl,
  },
  identity: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: { fontSize: 17, fontWeight: "800", color: colors.primary },
  idCol: { gap: 3, alignItems: "center", flexShrink: 1 },
  userName: { fontSize: 13, fontWeight: "400", color: colors.textMuted, maxWidth: 80 },
  rolePill: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rolePillOwner: { backgroundColor: "rgba(192,160,101,0.16)" },
  rolePillStaff: { backgroundColor: colors.primarySoft },
  rolePillText: { fontSize: 10, fontWeight: "800" },
  rolePillTextOwner: { color: "#8A6D3B" },
  rolePillTextStaff: { color: colors.primary },
});
