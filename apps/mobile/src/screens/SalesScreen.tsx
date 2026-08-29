import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RangeSalesReport, SaleOrderDetail } from "@cloth-scan/shared";
import { getSalesRange } from "../api";
import { BackButton } from "../components/BackButton";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space } from "../theme/tokens";
import { TimePickerSheet } from "./sales/TimePickerSheet";
import {
  DayBars,
  HeroCard,
  OrderRow,
  PeriodSwitcher,
  StaffCard,
  WeekRows,
  addDaysStr,
  cnToday,
  daysInMonth,
  fmtWeekCompact,
  monthWeekRows,
  ordersToBars,
  weekStartOfStr,
  type Granularity,
} from "./sales/SalesUi";

type SalesNav = NativeStackNavigationProp<RootStackParamList, "Sales">;

/** 视图切换动画方向：prev=往更早（内容自左滑入）next=更近（自右）down=粒度/选择器切换（自下淡入） */
type EnterDir = "left" | "right" | "down";

/**
 * 销售统计（重构版）
 *
 * 统一心智：粒度（日/周/月）分段 + ‹ › 翻期；每个时段一张「夜色账本」Hero 概览
 * （营业额/毛利/单数/件数 + 今日·本周·本月角标）+ 员工拆分（点击筛选流水）+ 流水。
 * 日=流水直出；周=每日柱图（柱顶数值）后员工；月=周表（自然周裁剪到月内）后员工。
 * 下钻链路：月（周表行）→ 周（每日柱）→ 日（流水）；右上角日历为通用时间选择器。
 * 取数统一走 /sales/range（合计+员工+流水一次拿全，≤62 天）。
 */
export function SalesScreen() {
  const navigation = useNavigation<SalesNav>();

  const [gran, setGran] = useState<Granularity>("day");
  const [anchor, setAnchor] = useState<string>(() => cnToday());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [operatorFilter, setOperatorFilter] = useState<string | null>(null);

  const [data, setData] = useState<RangeSalesReport | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const todayStr = cnToday();
  const listRef = useRef<FlatList<SaleOrderDetail>>(null);
  const enterDir = useRef<EnterDir>("down");

  // ---- 由粒度 + 锚点推导本期区间 -----------------------------------------
  const period = useMemo(() => {
    const [y, m] = anchor.split("-").map(Number);
    if (gran === "day") return { from: anchor, to: anchor };
    if (gran === "week") {
      const from = weekStartOfStr(anchor);
      return { from, to: addDaysStr(from, 6) };
    }
    const last = daysInMonth(y!, m!);
    const mm = String(m!).padStart(2, "0");
    return { from: `${y!}-${mm}-01`, to: `${y!}-${mm}-${String(last).padStart(2, "0")}` };
  }, [gran, anchor]);

  const viewKey = `${gran}:${period.from}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cur = await getSalesRange(period.from, period.to);
      setData(cur);
      setLoadedKey(`${gran}:${period.from}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [period, gran]);

  useEffect(() => {
    void load();
  }, [load]);

  // 从单据详情编辑/删除返回后刷新
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      void load();
    }, [load]),
  );

  // ---- 步进标签：纯数字+符号（"7·21" / "7·21–27" / "2026·7"） -------------
  const label = useMemo(() => {
    if (gran === "month") {
      const [y, m] = anchor.split("-").map(Number);
      return `${y}·${m}`;
    }
    if (gran === "week") return fmtWeekCompact(period.from, period.to);
    const [y, m, d] = anchor.split("-").map(Number);
    return y === Number(todayStr.split("-")[0]) ? `${m}·${d}` : `${y}·${m}·${d}`;
  }, [gran, anchor, period, todayStr]);

  const nextDisabled = period.to >= todayStr;

  // 当前时段角标：今日 / 本周 / 本月
  const isCurrentPeriod =
    gran === "day"
      ? anchor === todayStr
      : gran === "week"
        ? todayStr >= period.from && todayStr <= period.to
        : anchor.slice(0, 7) === todayStr.slice(0, 7);
  const periodTag = gran === "day" ? "今日" : gran === "week" ? "本周" : "本月";

  function scrollToTop() {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  function step(dir: -1 | 1) {
    enterDir.current = dir === -1 ? "left" : "right";
    if (gran === "month") {
      const [y, m] = anchor.split("-").map(Number);
      const nm = m! + dir;
      const ny = nm < 1 ? y! - 1 : nm > 12 ? y! + 1 : y!;
      const mm = ((nm - 1 + 12) % 12) + 1;
      setAnchor(`${ny}-${String(mm).padStart(2, "0")}-15`);
    } else {
      setAnchor(addDaysStr(anchor, gran === "day" ? dir : dir * 7));
    }
    setOperatorFilter(null);
    scrollToTop();
  }

  function switchGran(g: Granularity) {
    if (g === gran) return;
    enterDir.current = "down";
    setGran(g);
    setOperatorFilter(null);
    scrollToTop();
  }

  function backToCurrent() {
    enterDir.current = "down";
    setAnchor(todayStr);
    setOperatorFilter(null);
    scrollToTop();
  }

  function pickTime(g: Granularity, a: string) {
    enterDir.current = "down";
    setGran(g);
    setAnchor(a);
    setOperatorFilter(null);
    setPickerOpen(false);
    scrollToTop();
  }

  const orders = useMemo(() => {
    if (!data) return [];
    if (operatorFilter === null) return data.orders;
    return data.orders.filter((o) => (o.operatorId ?? "__none__") === operatorFilter);
  }, [data, operatorFilter]);

  const bars = useMemo(
    () =>
      gran === "week" && data ? ordersToBars(period.from, period.to, data.orders, todayStr) : [],
    [gran, data, period, todayStr],
  );

  const weekRows = useMemo(
    () =>
      gran === "month" && data ? monthWeekRows(period.from, period.to, data.orders, todayStr) : [],
    [gran, data, period, todayStr],
  );

  const stale = loadedKey !== viewKey; // 数据还是别的时段的，先别渲染卡片

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>销售统计</Text>
        <Pressable
          style={({ pressed }) => [styles.calBtn, pressed && styles.calBtnPressed]}
          onPress={() => setPickerOpen(true)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="选择时间"
        >
          <Ionicons name="calendar-outline" size={22} color={colors.text} />
        </Pressable>
      </View>

      <PeriodSwitcher
        gran={gran}
        onGran={switchGran}
        label={label}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        nextDisabled={nextDisabled}
      />

      <FlatList<SaleOrderDetail>
        ref={listRef}
        data={stale ? [] : orders}
        keyExtractor={(o) => o.id}
        onRefresh={() => void load()}
        refreshing={loading && loadedKey === viewKey}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <AnimatedHeader dir={enterDir.current} viewKey={viewKey}>
            {stale || !data ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : error ? (
              <View style={styles.center}>
                <Text style={styles.error}>{error}</Text>
                <Pressable style={styles.retry} onPress={() => void load()}>
                  <Text style={styles.retryText}>重试</Text>
                </Pressable>
              </View>
            ) : (
              <View>
                <HeroCard
                  revenue={data.total.revenue}
                  profit={data.total.profit}
                  orders={data.total.orders}
                  quantity={data.total.quantity}
                  periodTag={periodTag}
                  isCurrent={isCurrentPeriod}
                  onBackToCurrent={backToCurrent}
                />
                {gran === "week" ? (
                  <>
                    <View style={styles.gap12} />
                    <DayBars
                      data={bars}
                      onTapBar={(date) => {
                        enterDir.current = "down";
                        setGran("day");
                        setAnchor(date);
                        setOperatorFilter(null);
                        scrollToTop();
                      }}
                    />
                  </>
                ) : null}
                {gran === "month" ? (
                  <>
                    <View style={styles.gap12} />
                    <WeekRows
                      data={weekRows}
                      onTapWeek={(ws) => {
                        enterDir.current = "down";
                        setGran("week");
                        setAnchor(ws);
                        setOperatorFilter(null);
                        scrollToTop();
                      }}
                    />
                  </>
                ) : null}
                <View style={styles.gap12} />
                <StaffCard
                  ops={data.byOperator}
                  totalRevenue={data.total.revenue}
                  activeOperatorId={operatorFilter}
                  onToggle={setOperatorFilter}
                />
                <View style={styles.flowHead}>
                  <Text style={styles.flowTitle}>
                    流水 ·{" "}
                    {operatorFilter !== null
                      ? `${orders.length}/${data.total.orders}`
                      : data.total.orders}{" "}
                    单
                  </Text>
                  {operatorFilter !== null ? (
                    <Pressable
                      style={styles.filterChip}
                      onPress={() => setOperatorFilter(null)}
                      accessibilityRole="button"
                      accessibilityLabel="清除员工筛选"
                    >
                      <Ionicons name="close" size={12} color={colors.primary} />
                      <Text style={styles.filterChipText}>看全部</Text>
                    </Pressable>
                  ) : null}
                </View>
                {data.total.orders === 0 ? (
                  <Text style={styles.empty}>该时段还没有销售记录</Text>
                ) : orders.length === 0 ? (
                  <Text style={styles.empty}>该员工在此时段暂无流水</Text>
                ) : null}
              </View>
            )}
          </AnimatedHeader>
        }
        renderItem={({ item }) => (
          <OrderRow
            order={item}
            showDate={gran !== "day"}
            onPress={() => navigation.navigate("SaleDetail", { orderId: item.id })}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.gap8} />}
      />

      <TimePickerSheet
        visible={pickerOpen}
        gran={gran}
        anchor={anchor}
        today={todayStr}
        onClose={() => setPickerOpen(false)}
        onPick={pickTime}
      />
    </View>
  );
}

/** 视图切换过渡：轻量原生驱动（透明度 + 28px 位移，260ms cubic-out），随 viewKey 重放 */
function AnimatedHeader({
  dir,
  viewKey,
  children,
}: {
  dir: EnterDir;
  viewKey: string;
  children: ReactNode;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    t.setValue(0);
    Animated.timing(t, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [viewKey, t]);
  const dx = dir === "left" ? -28 : dir === "right" ? 28 : 0;
  const dy = dir === "down" ? 18 : 0;
  return (
    <Animated.View
      style={{
        opacity: t,
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [dx, 0] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F6F8" },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: "#fff",
  },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  calBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  calBtnPressed: { backgroundColor: "#EEF1F5" },
  list: { padding: space.lg, paddingBottom: 64 },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    paddingVertical: 80,
  },
  gap8: { height: space.sm },
  gap12: { height: space.md },
  flowHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  flowTitle: { fontSize: font.body, fontWeight: "800", color: colors.text },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  filterChipText: { fontSize: 12, fontWeight: "700", color: colors.primary },
  empty: { textAlign: "center", color: "#9CA3AF", marginTop: 28, fontSize: font.caption },
  error: { color: colors.danger },
  retry: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  retryText: { color: colors.primary, fontWeight: "700" },
});
