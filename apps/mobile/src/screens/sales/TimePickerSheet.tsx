import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, space } from "../../theme/tokens";
import { addDaysStr, daysInMonth, pad2, weekStartOfStr, type Granularity } from "./SalesUi";

/**
 * 通用时间选择弹窗：日（月历网格）/ 周（该月自然周列表）/ 月（12 宫格）。
 * 点选即跳转对应粒度视图；步进行按模式切换月或年，未来月份不可选。
 */

const WEEKDAY = ["一", "二", "三", "四", "五", "六", "日"];
const MIN_YEAR = 2024;

export function TimePickerSheet({
  visible,
  gran,
  anchor,
  today,
  onClose,
  onPick,
}: {
  visible: boolean;
  gran: Granularity;
  anchor: string; // YYYY-MM-DD（当前视图锚点）
  today: string; // YYYY-MM-DD
  onClose: () => void;
  onPick: (gran: Granularity, anchor: string) => void;
}) {
  const [mode, setMode] = useState<Granularity>(gran);
  const [ym, setYm] = useState(anchor.slice(0, 7)); // "YYYY-MM"

  useEffect(() => {
    if (visible) {
      setMode(gran);
      setYm(anchor.slice(0, 7));
    }
  }, [visible, gran, anchor]);

  const [y, m] = ym.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  const ymKey = `${y}-${pad2(m!)}`;
  const todayKey = `${ty}-${pad2(tm!)}`;
  const atMax = ymKey >= todayKey; // 已到当前月，不能再往后
  const atMin = y! <= MIN_YEAR;

  function stepYm(dir: number) {
    let nm = m! + dir;
    let ny = y!;
    if (nm < 1) {
      nm = 12;
      ny -= 1;
    } else if (nm > 12) {
      nm = 1;
      ny += 1;
    }
    setYm(`${ny}-${pad2(nm)}`);
  }

  // ---- 日模式：月历网格 --------------------------------------------------
  const dayGrid = useMemo(() => {
    const last = daysInMonth(y!, m!);
    const firstDow = (new Date(Date.UTC(y!, m! - 1, 1)).getUTCDay() + 6) % 7; // 周一=0
    const cells: ({
      day: number;
      date: string;
      disabled: boolean;
      selected: boolean;
      isToday: boolean;
    } | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= last; d++) {
      const date = `${y!}-${pad2(m!)}-${pad2(d)}`;
      cells.push({
        day: d,
        date,
        disabled: date > today,
        selected: mode === "day" && date === anchor,
        isToday: date === today,
      });
    }
    return cells;
  }, [y, m, today, anchor, mode]);

  // ---- 周模式：该月的自然周（裁剪到月内显示，跳转用整周周一；未来周不显示） ----
  const weekList = useMemo(() => {
    const monthFirst = `${y!}-${pad2(m!)}-01`;
    const monthLast = `${y!}-${pad2(m!)}-${pad2(daysInMonth(y!, m!))}`;
    const rows: {
      ws: string;
      from: string;
      to: string;
      isTodayWeek: boolean;
      selected: boolean;
    }[] = [];
    let ws = weekStartOfStr(monthFirst);
    for (; ws <= monthLast; ws = addDaysStr(ws, 7)) {
      const from = ws < monthFirst ? monthFirst : ws;
      if (from > today) break; // 本周之后的周还未发生，不显示
      const we = addDaysStr(ws, 6);
      const to = we > monthLast ? monthLast : we;
      rows.push({
        ws,
        from,
        to,
        isTodayWeek: today >= ws && today <= we,
        selected: mode === "week" && anchor >= ws && anchor <= we,
      });
    }
    return rows;
  }, [y, m, today, anchor, mode]);

  function fmtRange(from: string, to: string): string {
    const fm = Number(from.split("-")[1]);
    const fd = Number(from.split("-")[2]);
    const tm = Number(to.split("-")[1]);
    const td = Number(to.split("-")[2]);
    if (from === to) return `${fm}·${fd}`;
    return fm === tm ? `${fm}·${fd} - ${td}` : `${fm}·${fd} - ${tm}·${td}`;
  }

  const MODES: { key: Granularity; text: string }[] = [
    { key: "day", text: "日" },
    { key: "week", text: "周" },
    { key: "month", text: "月" },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={tpStyles.backdrop} onPress={onClose} />
      <View style={tpStyles.sheet}>
        <View style={tpStyles.head}>
          <Text style={tpStyles.title}>选择时间</Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="关闭"
          >
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* 粒度模式 */}
        <View style={tpStyles.seg}>
          {MODES.map((g) => (
            <Pressable
              key={g.key}
              style={[tpStyles.segBtn, mode === g.key && tpStyles.segBtnOn]}
              onPress={() => setMode(g.key)}
              accessibilityRole="button"
              accessibilityLabel={`按${g.text}选`}
            >
              <Text style={[tpStyles.segText, mode === g.key && tpStyles.segTextOn]}>{g.text}</Text>
            </Pressable>
          ))}
        </View>

        {/* 年/月步进 */}
        <View style={tpStyles.stepper}>
          <Pressable
            style={({ pressed }) => [tpStyles.arrow, pressed && tpStyles.arrowPressed]}
            onPress={() => stepYm(mode === "month" ? -12 : -1)}
            disabled={atMin}
            accessibilityRole="button"
            accessibilityLabel="上一年/月"
          >
            <Ionicons name="chevron-back" size={20} color={atMin ? "#C9CFDA" : "#1A1A1A"} />
          </Pressable>
          <Text style={tpStyles.stepperLabel}>{mode === "month" ? `${y}年` : `${y}年${m}月`}</Text>
          <Pressable
            style={({ pressed }) => [tpStyles.arrow, pressed && tpStyles.arrowPressed]}
            onPress={() => stepYm(mode === "month" ? 12 : 1)}
            disabled={atMax}
            accessibilityRole="button"
            accessibilityLabel="下一年/月"
          >
            <Ionicons name="chevron-forward" size={20} color={atMax ? "#C9CFDA" : "#1A1A1A"} />
          </Pressable>
        </View>

        {mode === "day" ? (
          <View>
            <View style={tpStyles.weekHead}>
              {WEEKDAY.map((w) => (
                <Text key={w} style={tpStyles.weekHeadText}>
                  {w}
                </Text>
              ))}
            </View>
            <View style={tpStyles.grid}>
              {dayGrid.map((c, i) =>
                c === null ? (
                  <View key={`blank-${i}`} style={tpStyles.cell} />
                ) : (
                  <Pressable
                    key={c.date}
                    style={({ pressed }) => [
                      tpStyles.cell,
                      tpStyles.dayCell,
                      c.isToday && tpStyles.dayToday,
                      c.selected && tpStyles.daySelected,
                      pressed && tpStyles.cellPressed,
                    ]}
                    onPress={() => onPick("day", c.date)}
                    disabled={c.disabled}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.date}`}
                  >
                    <Text
                      style={[
                        tpStyles.dayText,
                        c.disabled && tpStyles.dayTextOff,
                        c.isToday && !c.selected && tpStyles.dayTextToday,
                        c.selected && tpStyles.dayTextOn,
                      ]}
                    >
                      {c.day}
                    </Text>
                  </Pressable>
                ),
              )}
            </View>
          </View>
        ) : mode === "week" ? (
          <ScrollView style={tpStyles.weekScroll} contentContainerStyle={{ paddingBottom: 2 }}>
            {weekList.map((w, i) => (
              <Pressable
                key={w.ws}
                style={({ pressed }) => [
                  tpStyles.weekRow,
                  w.selected && tpStyles.weekRowOn,
                  pressed && tpStyles.cellPressed,
                ]}
                onPress={() => onPick("week", w.ws)}
                accessibilityRole="button"
                accessibilityLabel={`第${i + 1}周 ${fmtRange(w.from, w.to)}`}
              >
                <View style={tpStyles.weekBadge}>
                  <Text style={tpStyles.weekBadgeText}>第{i + 1}周</Text>
                </View>
                <Text style={[tpStyles.weekRange, w.selected && tpStyles.weekRangeOn]}>
                  {fmtRange(w.from, w.to)}
                </Text>
                {w.isTodayWeek ? (
                  <View style={tpStyles.curTag}>
                    <Text style={tpStyles.curTagText}>本周</Text>
                  </View>
                ) : null}
                <Ionicons
                  name="chevron-forward"
                  size={15}
                  color={w.selected ? colors.primary : "#C4CBD6"}
                />
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <View style={tpStyles.grid}>
            {Array.from({ length: 12 }, (_, i) => {
              const month = i + 1;
              const key = `${y}-${pad2(month)}`;
              const disabled = key > todayKey;
              const selected = mode === "month" && anchor.slice(0, 7) === key;
              return (
                <Pressable
                  key={key}
                  style={({ pressed }) => [
                    tpStyles.cell,
                    tpStyles.monCell,
                    selected && tpStyles.daySelected,
                    pressed && tpStyles.cellPressed,
                  ]}
                  onPress={() => onPick("month", `${y}-${pad2(month)}-15`)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`${y}年${month}月`}
                >
                  <Text
                    style={[
                      tpStyles.dayText,
                      disabled && tpStyles.dayTextOff,
                      selected && tpStyles.dayTextOn,
                    ]}
                  >
                    {month}月
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Pressable style={tpStyles.closeBtn} onPress={onClose}>
          <Text style={tpStyles.closeText}>取消</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const tpStyles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: {
    position: "absolute",
    left: 22,
    right: 22,
    top: "12%",
    maxHeight: "74%",
    backgroundColor: "#fff",
    borderRadius: radius.xl,
    padding: space.lg,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.md,
  },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  seg: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: "#EEF1F5",
    borderRadius: radius.pill,
    padding: 3,
    marginBottom: space.md,
  },
  segBtn: { paddingHorizontal: 26, paddingVertical: 6, borderRadius: radius.pill },
  segBtnOn: {
    backgroundColor: "#fff",
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  segText: { fontSize: 14, fontWeight: "700", color: colors.textMuted },
  segTextOn: { color: colors.primary },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    marginBottom: space.md,
  },
  arrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowPressed: { backgroundColor: "#EEF1F5" },
  stepperLabel: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
    minWidth: 96,
    textAlign: "center",
  },
  weekHead: { flexDirection: "row", marginBottom: 4 },
  weekHeadText: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700", color: "#A6AEBB" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "14.2857%", height: 40, alignItems: "center", justifyContent: "center" },
  dayCell: { borderRadius: 20 },
  dayToday: { borderWidth: 1.5, borderColor: colors.primary },
  daySelected: { backgroundColor: colors.primary, borderWidth: 0 },
  dayText: { fontSize: 14, fontWeight: "600", color: "#374151" },
  dayTextOff: { color: "#C9CFDA" },
  dayTextToday: { color: colors.primary, fontWeight: "800" },
  dayTextOn: { color: "#fff", fontWeight: "800" },
  cellPressed: { backgroundColor: "#F1F4F8" },
  monCell: { width: "33.3333%", height: 44, borderRadius: radius.md },
  weekScroll: { flexGrow: 0 },
  weekRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: radius.md,
  },
  weekRowOn: { backgroundColor: "#F0F5FF" },
  weekBadge: {
    minWidth: 56,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: "#EEF3FE",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  weekBadgeText: { fontSize: 11, fontWeight: "800", color: colors.primary },
  weekRange: { flex: 1, fontSize: 14, fontWeight: "700", color: "#1F2937" },
  weekRangeOn: { color: colors.primary },
  curTag: {
    paddingHorizontal: 8,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  curTagText: { fontSize: 10, fontWeight: "800", color: colors.primary },
  closeBtn: {
    marginTop: space.md,
    paddingVertical: 11,
    borderRadius: radius.md,
    alignItems: "center",
    backgroundColor: "#F1F4F8",
  },
  closeText: { fontSize: font.body, fontWeight: "700", color: "#374151" },
});
