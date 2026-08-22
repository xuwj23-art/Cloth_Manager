import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  HOT_CATEGORY_COUNT,
  PRESET_CATEGORIES,
  PRESET_COLORS,
  SYSTEM_COLORS,
} from "@cloth-scan/shared";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font, radius, space, touch } from "../../theme/tokens";
import { Chip } from "./Chip";

export type VisionDraft = {
  name: string;
  category: string;
  colors: string[];
};

export function VisionReviewModal({
  visible,
  initial,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  initial: { name: string; category: string; color: string } | null;
  onCancel: () => void;
  onConfirm: (draft: VisionDraft) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [colorsSel, setColorsSel] = useState<string[]>([]);
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [extraColors, setExtraColors] = useState<string[]>([]);
  const [customCategory, setCustomCategory] = useState("");
  const [customColor, setCustomColor] = useState("");
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible || !initial) return;
    setName(initial.name);
    setCategory(initial.category);
    setColorsSel(initial.color ? [initial.color] : []);
    setExtraCategories(
      initial.category && !(PRESET_CATEGORIES as readonly string[]).includes(initial.category)
        ? [initial.category]
        : [],
    );
    const knownColors = new Set<string>([...PRESET_COLORS, ...SYSTEM_COLORS]);
    setExtraColors(initial.color && !knownColors.has(initial.color) ? [initial.color] : []);
    setCustomCategory("");
    setCustomColor("");
    setCategoriesExpanded(false);
  }, [visible, initial]);

  function toggleColor(c: string) {
    setColorsSel((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function addCustomCat() {
    const v = customCategory.trim();
    if (!v) return;
    if (!(PRESET_CATEGORIES as readonly string[]).includes(v) && !extraCategories.includes(v)) {
      setExtraCategories((p) => [...p, v]);
    }
    setCategory(v);
    setCustomCategory("");
  }

  function addCustomCol() {
    const v = customColor.trim();
    if (!v) return;
    const known = new Set<string>([...PRESET_COLORS, ...SYSTEM_COLORS, ...extraColors]);
    if (!known.has(v)) setExtraColors((p) => [...p, v]);
    setColorsSel((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setCustomColor("");
  }

  const catChips = (() => {
    const all = [...PRESET_CATEGORIES, ...extraCategories];
    if (categoriesExpanded) return all;
    const base = [...PRESET_CATEGORIES.slice(0, HOT_CATEGORY_COUNT), ...extraCategories];
    if (category && !base.includes(category)) base.push(category);
    return base;
  })();

  const colorChips = [
    ...new Set([...PRESET_COLORS, ...SYSTEM_COLORS, ...extraColors, ...colorsSel]),
  ];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={styles.title}>核对识别结果</Text>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.label}>商品名称</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="商品名称"
              placeholderTextColor={colors.textMuted}
              maxLength={60}
            />

            <View style={styles.pickerHeader}>
              <Text style={styles.label}>品类</Text>
              <Pressable onPress={() => setCategoriesExpanded((v) => !v)} hitSlop={8}>
                <Text style={styles.expand}>{categoriesExpanded ? "收起" : "更多"}</Text>
              </Pressable>
            </View>
            <View style={styles.chips}>
              {catChips.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  active={category === c}
                  onPress={() => setCategory(category === c ? "" : c)}
                />
              ))}
            </View>
            <View style={styles.addRow}>
              <TextInput
                style={[styles.input, styles.flex1, styles.mini]}
                placeholder="自定义品类"
                placeholderTextColor={colors.textMuted}
                value={customCategory}
                onChangeText={setCustomCategory}
                onSubmitEditing={addCustomCat}
              />
              <Pressable style={styles.addBtn} onPress={addCustomCat}>
                <Text style={styles.addBtnText}>添加</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>颜色</Text>
            <View style={styles.chips}>
              {colorChips.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  active={colorsSel.includes(c)}
                  onPress={() => toggleColor(c)}
                />
              ))}
            </View>
            <View style={styles.addRow}>
              <TextInput
                style={[styles.input, styles.flex1, styles.mini]}
                placeholder="自定义颜色"
                placeholderTextColor={colors.textMuted}
                value={customColor}
                onChangeText={setCustomColor}
                onSubmitEditing={addCustomCol}
              />
              <Pressable style={styles.addBtn} onPress={addCustomCol}>
                <Text style={styles.addBtnText}>添加</Text>
              </Pressable>
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>取消</Text>
            </Pressable>
            <Pressable
              style={styles.okBtn}
              onPress={() => onConfirm({ name: name.trim(), category, colors: colorsSel })}
            >
              <Text style={styles.okText}>确认</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.xl,
    paddingBottom: space.xxl,
    maxHeight: "86%",
    gap: space.sm,
  },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: space.md, gap: 2 },
  label: {
    fontSize: font.body,
    fontWeight: "700",
    color: colors.text,
    marginTop: space.md,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.md,
  },
  expand: { fontSize: font.caption, color: colors.primary, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.bg,
    marginTop: 6,
  },
  mini: { paddingVertical: 10, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
  flex1: { flex: 1 },
  addBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  addBtnText: { color: colors.primary, fontWeight: "700", fontSize: font.body },
  actions: { flexDirection: "row", gap: 12, marginTop: space.md },
  cancelBtn: {
    flex: 1,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: font.body, fontWeight: "700", color: colors.text },
  okBtn: {
    flex: 1.2,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  okText: { fontSize: font.body, fontWeight: "800", color: "#fff" },
});
