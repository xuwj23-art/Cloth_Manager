import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  HOT_CATEGORY_COUNT,
  HOT_MATERIAL_COUNT,
  PRESET_CATEGORIES,
  PRESET_COLORS,
  PRESET_MATERIALS,
  PRESET_SIZES,
  SYSTEM_COLORS,
  TITLE_MAX,
  TITLE_MIN,
  type ProductWithSkus,
  type UpdateSkuInput,
} from "@cloth-scan/shared";
import { imageUrl, setProductArchived, updateProduct, uploadImage } from "../api";
import { useAuth } from "../auth-context";
import { BackButton } from "../components/BackButton";
import { ImageViewer } from "../components/ImageViewer";
import { useDialog } from "../dialog-context";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space, touch } from "../theme/tokens";
import { isPickerCancelled, pickProductImage } from "../utils/image-pick";
import { useKeyboardHeight, useKeyboardReveal } from "../utils/kb";
import { yuan } from "../utils/format";
import { Chip } from "./create-product/Chip";
import { PhotoSlots, type PhotoKey } from "./create-product/PhotoSlots";
import { PhotoSourceSheet } from "./create-product/PhotoSourceSheet";

type EditProductNav = NativeStackNavigationProp<RootStackParamList, "EditProduct">;
type EditProductRoute = RouteProp<RootStackParamList, "EditProduct">;

function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

function yuanToCents(text: string): number | null {
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function initialPhotos(product: {
  images: string[];
  coverImage: string | null;
}): Record<PhotoKey, string | null> {
  const imgs = product.images?.length
    ? product.images
    : product.coverImage
      ? [product.coverImage]
      : [];
  return {
    front: imgs[0] ?? null,
    back: imgs[1] ?? null,
    detail: imgs[2] ?? null,
  };
}

interface SkuDraft {
  id: string;
  color: string;
  size: string;
  costPrice: string;
  salePrice: string;
  stock: string;
}

function skuDrafts(product: ProductWithSkus): SkuDraft[] {
  return product.skus.map((s) => ({
    id: s.id,
    color: s.color,
    size: s.size,
    costPrice: centsToYuan(s.costPrice),
    salePrice: centsToYuan(s.salePrice),
    stock: String(s.stock),
  }));
}

const COLOR_PRESETS: string[] = [...PRESET_COLORS, ...SYSTEM_COLORS];

export function EditProductScreen() {
  const navigation = useNavigation<EditProductNav>();
  const route = useRoute<EditProductRoute>();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const { confirm, notice } = useDialog();
  const savedRef = useRef<ProductWithSkus>(route.params.product);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(savedRef.current.name);
  const [photos, setPhotos] = useState<Record<PhotoKey, string | null>>(() =>
    initialPhotos(savedRef.current),
  );
  const [uploadingKey, setUploadingKey] = useState<PhotoKey | null>(null);
  const [pickingKey, setPickingKey] = useState<PhotoKey | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [material, setMaterial] = useState(savedRef.current.material ?? "默认");
  const [category, setCategory] = useState(savedRef.current.categoryName ?? "");
  const [extraMaterials, setExtraMaterials] = useState<string[]>(() =>
    savedRef.current.material &&
    !(PRESET_MATERIALS as readonly string[]).includes(savedRef.current.material)
      ? [savedRef.current.material]
      : [],
  );
  const [extraCategories, setExtraCategories] = useState<string[]>(() =>
    savedRef.current.categoryName &&
    !(PRESET_CATEGORIES as readonly string[]).includes(savedRef.current.categoryName)
      ? [savedRef.current.categoryName]
      : [],
  );
  const [customMaterial, setCustomMaterial] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [materialsExpanded, setMaterialsExpanded] = useState(false);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [skus, setSkus] = useState<SkuDraft[]>(() => skuDrafts(savedRef.current));
  const [saving, setSaving] = useState(false);
  const archived = !!savedRef.current.archivedAt;

  // 键盘避让：滚动位置追踪 + 各 SKU 数字输入框聚焦时滚入可视区
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  // 键盘展开时给内容底部补位：末尾字段（库存）已到滚动尽头，无补位则 scrollTo 无余量
  const kbPad = useKeyboardHeight();
  // 全量键盘避让：keyboardDidShow 后按「此刻聚焦」的输入框补位，
  // 无需逐字段 onFocus 登记（材质/品类/品名等历史漏网字段一并覆盖，且无陈旧目标）
  useKeyboardReveal(scrollRef, () => scrollYRef.current);

  function hydrate(p: ProductWithSkus) {
    setName(p.name);
    setPhotos(initialPhotos(p));
    setMaterial(p.material ?? "默认");
    setCategory(p.categoryName ?? "");
    setExtraMaterials(
      p.material && !(PRESET_MATERIALS as readonly string[]).includes(p.material)
        ? [p.material]
        : [],
    );
    setExtraCategories(
      p.categoryName && !(PRESET_CATEGORIES as readonly string[]).includes(p.categoryName)
        ? [p.categoryName]
        : [],
    );
    setCustomMaterial("");
    setCustomCategory("");
    setMaterialsExpanded(false);
    setCategoriesExpanded(false);
    setSkus(skuDrafts(p));
    setPickingKey(null);
  }

  function cancelEdit() {
    hydrate(savedRef.current);
    setEditing(false);
  }

  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", (e) => {
      if (!editing) return;
      e.preventDefault();
      cancelEdit();
    });
    return unsub;
  }, [navigation, editing]);

  function patchSku(id: string, patch: Partial<SkuDraft>) {
    setSkus((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function pickFrom(key: PhotoKey, fromCamera: boolean) {
    let uri: string;
    try {
      uri = await pickProductImage(fromCamera);
    } catch (e) {
      if (!isPickerCancelled(e)) {
        await notice(fromCamera ? "无法使用相机" : "无法访问相册");
      }
      return;
    }
    setUploadingKey(key);
    try {
      const path = await uploadImage(uri);
      setPhotos((p) => ({ ...p, [key]: path }));
    } catch (e) {
      await notice("图片上传失败", (e as Error).message);
    } finally {
      setUploadingKey(null);
    }
  }

  function onPhotoPress(key: PhotoKey) {
    if (editing) {
      setPickingKey(key);
      return;
    }
    const path = photos[key];
    const uri = imageUrl(path);
    if (uri) setViewerUri(uri);
  }

  function addCustomMaterial() {
    const v = customMaterial.trim();
    if (!v) return;
    if (!(PRESET_MATERIALS as readonly string[]).includes(v) && !extraMaterials.includes(v)) {
      setExtraMaterials((p) => [...p, v]);
    }
    setMaterial(v);
    setCustomMaterial("");
  }

  function addCustomCategory() {
    const v = customCategory.trim();
    if (!v) return;
    if (!(PRESET_CATEGORIES as readonly string[]).includes(v) && !extraCategories.includes(v)) {
      setExtraCategories((p) => [...p, v]);
    }
    setCategory(v);
    setCustomCategory("");
  }

  async function save() {
    if (!isOwner) return;
    const trimmed = name.trim();
    if (trimmed.length < TITLE_MIN || trimmed.length > TITLE_MAX) {
      await notice("商品名称有误", `请填写 ${TITLE_MIN}～${TITLE_MAX} 个字`);
      return;
    }
    const skuInputs: UpdateSkuInput[] = [];
    const specKeys = new Set<string>();
    for (const s of skus) {
      const color = s.color.trim();
      const size = s.size.trim();
      if (!color || !size) {
        await notice("请填写颜色和尺码");
        return;
      }
      const specKey = `${color}\u0000${size}`;
      if (specKeys.has(specKey)) {
        await notice("规格重复", "同一商品下颜色和尺码不能重复");
        return;
      }
      specKeys.add(specKey);
      const cents = yuanToCents(s.salePrice);
      if (cents === null) {
        await notice("售价有误", `${color}/${size}`);
        return;
      }
      const costCents = yuanToCents(s.costPrice);
      if (costCents === null) {
        await notice("进价有误", `${color}/${size}`);
        return;
      }
      const stock = Number(s.stock);
      if (!Number.isInteger(stock) || stock < 0) {
        await notice("库存有误", `${color}/${size}`);
        return;
      }
      skuInputs.push({
        id: s.id,
        color,
        size,
        costPrice: costCents,
        salePrice: cents,
        stock,
      });
    }
    const images = [photos.front, photos.back, photos.detail].filter((x): x is string =>
      Boolean(x),
    );
    setSaving(true);
    try {
      const updated = await updateProduct(savedRef.current.id, {
        name: trimmed,
        images,
        material: material || null,
        categoryName: category || null,
        skus: skuInputs,
      });
      savedRef.current = updated;
      hydrate(updated);
      setEditing(false);
    } catch (e) {
      await notice("保存失败", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive() {
    const next = !archived;
    const name = savedRef.current.name;
    const ok = await confirm({
      title: next ? "下架商品" : "恢复在售",
      message: next ? `确定下架「${name}」？` : `确定将「${name}」重新上架？`,
      confirmLabel: next ? "下架" : "上架",
      destructive: next,
    });
    if (!ok) return;
    try {
      await setProductArchived(savedRef.current.id, next);
      navigation.goBack();
    } catch (e) {
      await notice("操作失败", (e as Error).message);
    }
  }

  const materialChips = (() => {
    const all = [...PRESET_MATERIALS, ...extraMaterials];
    if (materialsExpanded) return all;
    const base = [...PRESET_MATERIALS.slice(0, HOT_MATERIAL_COUNT), ...extraMaterials];
    if (material && !base.includes(material)) base.push(material);
    return base;
  })();
  const categoryChips = (() => {
    const all = [...PRESET_CATEGORIES, ...extraCategories];
    if (categoriesExpanded) return all;
    const base = [...PRESET_CATEGORIES.slice(0, HOT_CATEGORY_COUNT), ...extraCategories];
    if (category && !base.includes(category)) base.push(category);
    return base;
  })();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.topbar}>
        {editing ? (
          <Pressable onPress={cancelEdit} hitSlop={8} style={styles.topAction}>
            <Text style={styles.backMuted}>取消</Text>
          </Pressable>
        ) : (
          <BackButton onPress={() => navigation.goBack()} />
        )}
        <Text style={styles.title}>{editing ? "编辑商品" : "商品详情"}</Text>
        {editing ? (
          <Pressable
            onPress={() => void save()}
            hitSlop={8}
            disabled={saving}
            style={styles.topAction}
          >
            <Text style={[styles.saveLink, saving && styles.dim]}>
              {saving ? "保存中" : "保存"}
            </Text>
          </Pressable>
        ) : isOwner ? (
          <Pressable
            onPress={() => setEditing(true)}
            hitSlop={8}
            style={styles.topAction}
            accessibilityRole="button"
            accessibilityLabel="编辑"
          >
            <Ionicons name="settings-outline" size={22} color={colors.danger} />
          </Pressable>
        ) : (
          <View style={styles.topAction} />
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        onScroll={(e) => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.body, { paddingBottom: 40 + kbPad }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>商品照片</Text>
          <PhotoSlots
            photos={photos}
            uploadingKey={uploadingKey}
            onPressSlot={onPhotoPress}
            mode={editing ? "edit" : "view"}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>商品名称</Text>
          {editing ? (
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              maxLength={TITLE_MAX}
            />
          ) : (
            <Text style={styles.valueText}>{name}</Text>
          )}
          {archived ? <Text style={styles.archivedTag}>已售罄/已下架</Text> : null}

          {editing ? (
            <>
              <View style={styles.pickerHeader}>
                <Text style={styles.sectionTitle}>材质</Text>
                <Pressable onPress={() => setMaterialsExpanded((v) => !v)} hitSlop={8}>
                  <Text style={styles.expand}>{materialsExpanded ? "收起" : "更多"}</Text>
                </Pressable>
              </View>
              <View style={styles.chips}>
                {materialChips.map((m) => (
                  <Chip
                    key={m}
                    label={m}
                    active={material === m}
                    onPress={() => setMaterial(material === m ? "" : m)}
                  />
                ))}
              </View>
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.input, styles.flex1, styles.mini]}
                  placeholder="自定义材质"
                  placeholderTextColor={colors.textMuted}
                  value={customMaterial}
                  onChangeText={setCustomMaterial}
                  onSubmitEditing={() => addCustomMaterial()}
                />
                <Pressable style={styles.miniAdd} onPress={() => addCustomMaterial()}>
                  <Text style={styles.miniAddText}>+</Text>
                </Pressable>
              </View>

              <View style={styles.pickerHeader}>
                <Text style={styles.sectionTitle}>品类</Text>
                <Pressable onPress={() => setCategoriesExpanded((v) => !v)} hitSlop={8}>
                  <Text style={styles.expand}>{categoriesExpanded ? "收起" : "更多"}</Text>
                </Pressable>
              </View>
              <View style={styles.chips}>
                {categoryChips.map((c) => (
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
                  onSubmitEditing={() => addCustomCategory()}
                />
                <Pressable style={styles.miniAdd} onPress={() => addCustomCategory()}>
                  <Text style={styles.miniAddText}>+</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>材质</Text>
                <Text style={styles.infoValue}>{material || "—"}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>品类</Text>
                <Text style={styles.infoValue}>{category || "—"}</Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>规格 · 售价 · 库存</Text>
          {skus.map((s) => {
            const cents = yuanToCents(s.salePrice);
            const colorChips = COLOR_PRESETS.includes(s.color)
              ? COLOR_PRESETS
              : [...COLOR_PRESETS, s.color];
            const sizeChips = (PRESET_SIZES as readonly string[]).includes(s.size)
              ? [...PRESET_SIZES]
              : [...PRESET_SIZES, s.size];
            return editing ? (
              <View key={s.id} style={styles.skuEdit}>
                <Text style={styles.skuEditTitle}>
                  {s.color.trim() || "颜色"} / {s.size.trim() || "尺码"}
                </Text>
                <Text style={styles.fieldLabel}>颜色</Text>
                <TextInput
                  style={styles.input}
                  value={s.color}
                  onChangeText={(t) => patchSku(s.id, { color: t })}
                  maxLength={40}
                />
                <View style={styles.chips}>
                  {colorChips.map((c) => (
                    <Chip
                      key={c}
                      label={c}
                      active={s.color === c}
                      onPress={() => patchSku(s.id, { color: c })}
                    />
                  ))}
                </View>
                <Text style={[styles.fieldLabel, { marginTop: 8 }]}>尺码</Text>
                <TextInput
                  style={styles.input}
                  value={s.size}
                  onChangeText={(t) => patchSku(s.id, { size: t })}
                  maxLength={20}
                />
                <View style={styles.chips}>
                  {sizeChips.map((sz) => (
                    <Chip
                      key={sz}
                      label={sz}
                      active={s.size === sz}
                      onPress={() => patchSku(s.id, { size: sz })}
                    />
                  ))}
                </View>
                <View style={styles.skuPriceRow}>
                  <View style={styles.fieldGrow}>
                    <Text style={styles.fieldLabel} numberOfLines={1} adjustsFontSizeToFit>
                      进价(元)
                    </Text>
                    <TextInput
                      style={styles.fieldInput}
                      keyboardType="decimal-pad"
                      value={s.costPrice}
                      onChangeText={(t) => patchSku(s.id, { costPrice: t })}
                    />
                  </View>
                  <View style={styles.fieldGrow}>
                    <Text style={styles.fieldLabel} numberOfLines={1} adjustsFontSizeToFit>
                      售价(元)
                    </Text>
                    <TextInput
                      style={styles.fieldInput}
                      keyboardType="decimal-pad"
                      value={s.salePrice}
                      onChangeText={(t) => patchSku(s.id, { salePrice: t })}
                    />
                  </View>
                  <View style={styles.fieldGrow}>
                    <Text style={styles.fieldLabel} numberOfLines={1} adjustsFontSizeToFit>
                      库存
                    </Text>
                    <TextInput
                      style={styles.fieldInput}
                      keyboardType="number-pad"
                      value={s.stock}
                      onChangeText={(t) => patchSku(s.id, { stock: t })}
                    />
                  </View>
                </View>
              </View>
            ) : (
              <View key={s.id} style={styles.skuRow}>
                <Text style={styles.skuSpec}>
                  {s.color}/{s.size}
                </Text>
                <View style={styles.skuViewRight}>
                  <Text style={styles.skuPrice}>{cents === null ? s.salePrice : yuan(cents)}</Text>
                  <Text style={styles.skuStock}>库存 {s.stock}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {!editing ? (
          <>
            <Pressable
              style={styles.printBtn}
              onPress={() => navigation.navigate("LabelPrint", { product: savedRef.current })}
            >
              <Text style={styles.printText}>打印吊牌二维码</Text>
            </Pressable>
            {isOwner ? (
              <Pressable
                style={[styles.archiveBtn, archived ? styles.restore : styles.archive]}
                onPress={() => void toggleArchive()}
              >
                <Text
                  style={[
                    styles.archiveText,
                    archived ? styles.restoreText : styles.archiveTextColor,
                  ]}
                >
                  {archived ? "恢复在售" : "下架商品"}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <PhotoSourceSheet
        visible={pickingKey !== null}
        label={pickingKey === "back" ? "反面" : pickingKey === "detail" ? "细节" : "正面"}
        onCamera={() => {
          const key = pickingKey;
          setPickingKey(null);
          if (key) void pickFrom(key, true);
        }}
        onLibrary={() => {
          const key = pickingKey;
          setPickingKey(null);
          if (key) void pickFrom(key, false);
        }}
        onClose={() => setPickingKey(null)}
      />
      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topAction: {
    width: touch.minSize,
    height: touch.minSize,
    alignItems: "center",
    justifyContent: "center",
  },
  backMuted: { color: colors.textMuted, fontSize: font.body },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  saveLink: {
    color: colors.primary,
    fontSize: font.body,
    fontWeight: "700",
  },
  dim: { opacity: 0.5 },
  body: { padding: space.lg, gap: space.md, paddingBottom: 40 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: 4,
  },
  sectionTitle: { fontSize: font.body, fontWeight: "700", color: colors.text, marginTop: 4 },
  valueText: {
    fontSize: font.body,
    color: colors.text,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 4,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.md,
    paddingVertical: 4,
  },
  infoLabel: { fontSize: font.body, color: colors.textMuted },
  infoValue: { fontSize: font.body, fontWeight: "700", color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.bg,
    marginTop: 6,
  },
  mini: { paddingVertical: 9 },
  archivedTag: { color: colors.warn, fontSize: font.caption, fontWeight: "700", marginTop: 6 },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.md,
  },
  expand: { fontSize: font.caption, color: colors.primary, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  flex1: { flex: 1 },
  miniAdd: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  miniAddText: { color: colors.primary, fontSize: 22, fontWeight: "700", lineHeight: 24 },
  skuRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  skuEdit: {
    marginTop: 10,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    gap: 4,
  },
  skuEditTitle: { fontSize: font.body, fontWeight: "700", color: colors.text, marginBottom: 4 },
  skuSpec: { flex: 1, fontSize: font.body, fontWeight: "600", color: colors.text },
  skuViewRight: { alignItems: "flex-end", gap: 2 },
  skuPrice: { fontSize: font.body, fontWeight: "800", color: colors.primary },
  skuStock: { fontSize: font.caption, color: colors.textMuted },
  skuPriceRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  fieldGrow: { flex: 1, minWidth: 0, gap: 4 },
  fieldLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
    includeFontPadding: false,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minHeight: 40,
    fontSize: font.body,
    textAlign: "center",
    backgroundColor: colors.card,
    color: colors.text,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  printBtn: {
    marginTop: 4,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: colors.text,
  },
  printText: { color: "#fff", fontSize: font.body, fontWeight: "700" },
  archiveBtn: {
    marginTop: 4,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1.5,
  },
  archive: { borderColor: "#fca5a5", backgroundColor: colors.dangerSoft },
  restore: { borderColor: "#86efac", backgroundColor: "#f0fdf4" },
  archiveText: { fontSize: font.body, fontWeight: "700" },
  archiveTextColor: { color: colors.danger },
  restoreText: { color: colors.online },
});
