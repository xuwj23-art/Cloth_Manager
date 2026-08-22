import { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import {
  HOT_CATEGORY_COUNT,
  HOT_MATERIAL_COUNT,
  PRESET_CATEGORIES,
  PRESET_MATERIALS,
  TITLE_MAX,
  TITLE_MIN,
  type ProductWithSkus,
  type UpdateSkuInput,
} from "@cloth-scan/shared";
import { imageUrl, setProductArchived, updateProduct, uploadImage } from "../api";
import { ImageViewer } from "../components/ImageViewer";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space } from "../theme/tokens";
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
  salePrice: string;
  stock: string;
}

function skuDrafts(product: ProductWithSkus): SkuDraft[] {
  return product.skus.map((s) => ({
    id: s.id,
    color: s.color,
    size: s.size,
    salePrice: centsToYuan(s.salePrice),
    stock: String(s.stock),
  }));
}

export function EditProductScreen() {
  const navigation = useNavigation<EditProductNav>();
  const route = useRoute<EditProductRoute>();
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
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("需要相册/相机权限");
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingKey(key);
    try {
      const path = await uploadImage(result.assets[0].uri);
      setPhotos((p) => ({ ...p, [key]: path }));
    } catch (e) {
      Alert.alert("图片上传失败", (e as Error).message);
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
    const trimmed = name.trim();
    if (trimmed.length < TITLE_MIN || trimmed.length > TITLE_MAX) {
      Alert.alert("请填写商品名称", `名称需要 ${TITLE_MIN}～${TITLE_MAX} 个字`);
      return;
    }
    const skuInputs: UpdateSkuInput[] = [];
    for (const s of skus) {
      const cents = yuanToCents(s.salePrice);
      if (cents === null) {
        Alert.alert("价格有误", `${s.color}/${s.size} 的售价请填写有效数字`);
        return;
      }
      const stock = Number(s.stock);
      if (!Number.isInteger(stock) || stock < 0) {
        Alert.alert("库存有误", `${s.color}/${s.size} 的库存请填写非负整数`);
        return;
      }
      skuInputs.push({ id: s.id, salePrice: cents, stock });
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
      Alert.alert("保存失败", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive() {
    const next = !archived;
    Alert.alert(
      next ? "下架商品" : "恢复在售",
      next
        ? "下架后将从在售列表隐藏（移入「已售罄」），不影响历史销售记录。"
        : "恢复后将重新出现在在售列表。",
      [
        { text: "取消", style: "cancel" },
        {
          text: next ? "下架" : "恢复",
          style: next ? "destructive" : "default",
          onPress: async () => {
            try {
              await setProductArchived(savedRef.current.id, next);
              navigation.goBack();
            } catch (e) {
              Alert.alert("操作失败", (e as Error).message);
            }
          },
        },
      ],
    );
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
          <Pressable onPress={cancelEdit} hitSlop={8}>
            <Text style={styles.backMuted}>取消</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Text style={styles.back}>返回</Text>
          </Pressable>
        )}
        <Text style={styles.title}>{editing ? "编辑商品" : "商品详情"}</Text>
        {editing ? (
          <Pressable onPress={() => void save()} hitSlop={8} disabled={saving}>
            <Text style={[styles.saveLink, saving && styles.dim]}>
              {saving ? "保存中" : "保存"}
            </Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => setEditing(true)} hitSlop={8}>
            <Text style={styles.editLink}>编辑</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
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
            return (
              <View key={s.id} style={styles.skuRow}>
                <Text style={styles.skuSpec}>
                  {s.color}/{s.size}
                </Text>
                {editing ? (
                  <>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>售价(元)</Text>
                      <TextInput
                        style={styles.fieldInput}
                        keyboardType="decimal-pad"
                        value={s.salePrice}
                        onChangeText={(t) => patchSku(s.id, { salePrice: t })}
                      />
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>库存</Text>
                      <TextInput
                        style={styles.fieldInput}
                        keyboardType="number-pad"
                        value={s.stock}
                        onChangeText={(t) => patchSku(s.id, { stock: t })}
                      />
                    </View>
                  </>
                ) : (
                  <View style={styles.skuViewRight}>
                    <Text style={styles.skuPrice}>
                      {cents === null ? s.salePrice : yuan(cents)}
                    </Text>
                    <Text style={styles.skuStock}>库存 {s.stock}</Text>
                  </View>
                )}
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
  back: { color: colors.primary, fontSize: font.body, fontWeight: "600", width: 48 },
  backMuted: { color: colors.textMuted, fontSize: font.body, width: 48 },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  saveLink: {
    color: colors.primary,
    fontSize: font.body,
    fontWeight: "700",
    width: 48,
    textAlign: "right",
  },
  editLink: {
    color: colors.danger,
    fontSize: font.body,
    fontWeight: "700",
    width: 48,
    textAlign: "right",
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
  skuSpec: { flex: 1, fontSize: font.body, fontWeight: "600", color: colors.text },
  skuViewRight: { alignItems: "flex-end", gap: 2 },
  skuPrice: { fontSize: font.body, fontWeight: "800", color: colors.primary },
  skuStock: { fontSize: font.caption, color: colors.textMuted },
  field: { width: 92, gap: 4 },
  fieldLabel: { fontSize: 12, color: colors.textMuted },
  fieldInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: font.body,
    textAlign: "center",
    backgroundColor: colors.bg,
    color: colors.text,
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
