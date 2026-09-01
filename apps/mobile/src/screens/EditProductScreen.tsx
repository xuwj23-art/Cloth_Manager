import { useEffect, useMemo, useRef, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  HOT_CATEGORY_COUNT,
  HOT_MATERIAL_COUNT,
  memberPriceToTagPrice,
  PRESET_CATEGORIES,
  PRESET_COLORS,
  PRESET_MATERIALS,
  PRESET_SIZE_GROUPS,
  SYSTEM_COLORS,
  TITLE_MAX,
  TITLE_MIN,
  type CreateSkuInput,
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

/**
 * SKU 编辑行（单颜色模型）：颜色/进价/会员价为商品级统一字段，行内只有尺码+库存。
 * isNew 行为本次编辑新增的尺码（保存时走 addSkus）；删除的既有行记入 removeIds（软删）。
 */
interface SkuDraft {
  id: string;
  size: string;
  stock: string;
  isNew?: boolean;
}

function skuDrafts(product: ProductWithSkus): SkuDraft[] {
  return product.skus.map((s) => ({
    id: s.id,
    size: s.size,
    stock: String(s.stock),
  }));
}

/** 商品级统一字段的初始值：取第一个 SKU（颜色/进价/会员价全商品一致） */
function productLevelDefaults(p: ProductWithSkus) {
  const first = p.skus[0];
  return {
    color: first?.color ?? "",
    costPrice: first ? centsToYuan(first.costPrice) : "",
    salePrice: first ? centsToYuan(first.salePrice) : "",
  };
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
  /** 本次编辑删除的既有 SKU id（保存时软删） */
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  /** 尺码编辑弹层：pick = 当前选中尺码（保存/取消/删除） */
  const [editPicker, setEditPicker] = useState<{
    draftId: string;
    pick: string;
    err?: string;
  } | null>(null);
  /** 新增尺码弹层：pick = 选中尺码，qty = 初始库存 */
  const [addPicker, setAddPicker] = useState<{ pick: string; qty: string; err?: string } | null>(
    null,
  );
  // 商品级统一字段：单颜色 + 统一进价/会员价
  const defaults = useMemo(() => productLevelDefaults(savedRef.current), []);
  const [colorSel, setColorSel] = useState(defaults.color);
  const [customColor, setCustomColor] = useState("");
  const [costPrice, setCostPrice] = useState(defaults.costPrice);
  const [salePrice, setSalePrice] = useState(defaults.salePrice);
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
    setCustomColor("");
    setMaterialsExpanded(false);
    setCategoriesExpanded(false);
    setSkus(skuDrafts(p));
    setRemoveIds([]);
    setEditPicker(null);
    setAddPicker(null);
    const d = productLevelDefaults(p);
    setColorSel(d.color);
    setCostPrice(d.costPrice);
    setSalePrice(d.salePrice);
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

  /** 步进调整某行库存（0 = 该码售罄，允许；不要该码走尺码弹层的删除） */
  function bumpStock(draftId: string, delta: number) {
    setSkus((prev) =>
      prev.map((s) =>
        s.id === draftId
          ? { ...s, stock: String(Math.max(0, Math.min(9_999, (Number(s.stock) || 0) + delta))) }
          : s,
      ),
    );
  }

  function setStockRaw(draftId: string, raw: string) {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 4);
    setSkus((prev) => prev.map((s) => (s.id === draftId ? { ...s, stock: digits } : s)));
  }

  /** 尺码弹层-保存：改为新选尺码（与其他行查重） */
  function confirmEditSize() {
    if (!editPicker) return;
    const { draftId, pick } = editPicker;
    if (!pick) {
      setEditPicker({ ...editPicker, err: "请选择尺码" });
      return;
    }
    if (skus.some((s) => s.id !== draftId && s.size === pick)) {
      setEditPicker({ ...editPicker, err: `尺码 ${pick} 已存在` });
      return;
    }
    setSkus((prev) => prev.map((s) => (s.id === draftId ? { ...s, size: pick } : s)));
    setEditPicker(null);
  }

  /** 尺码弹层-删除：新增行直接移除；既有行记入软删名单（保存才生效） */
  function removeDraft(draftId: string) {
    const draft = skus.find((s) => s.id === draftId);
    setSkus((prev) => prev.filter((s) => s.id !== draftId));
    if (draft && !draft.isNew) {
      setRemoveIds((prev) => (prev.includes(draftId) ? prev : [...prev, draftId]));
    }
    setEditPicker(null);
  }

  /** 新增尺码弹层-添加 */
  function confirmAddSize() {
    if (!addPicker) return;
    const { pick, qty } = addPicker;
    if (!pick) {
      setAddPicker({ ...addPicker, err: "请选择尺码" });
      return;
    }
    if (skus.some((s) => s.size === pick)) {
      setAddPicker({ ...addPicker, err: `尺码 ${pick} 已存在` });
      return;
    }
    const stock = Math.max(1, Number(qty) || 1);
    setSkus((prev) => [
      ...prev,
      { id: `new-${Date.now()}`, size: pick, stock: String(stock), isNew: true },
    ]);
    setAddPicker(null);
  }

  function bumpAddQty(delta: number) {
    if (!addPicker) return;
    const next = Math.max(1, Math.min(9_999, (Number(addPicker.qty) || 1) + delta));
    setAddPicker({ ...addPicker, qty: String(next), err: undefined });
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
    // 商品级统一字段：颜色/进价/会员价
    const nextColor = colorSel.trim();
    const costCents = yuanToCents(costPrice); // 空输入按 0（选填）
    const saleCents = yuanToCents(salePrice);
    if (!nextColor) {
      await notice("请选择颜色");
      return;
    }
    if (saleCents === null) {
      await notice("会员价有误");
      return;
    }

    if (skus.length === 0) {
      await notice("至少保留一个尺码");
      return;
    }
    const prevById = new Map(savedRef.current.skus.map((s) => [s.id, s]));
    const skuInputs: UpdateSkuInput[] = [];
    const addInputs: CreateSkuInput[] = [];
    const specKeys = new Set<string>();
    for (const s of skus) {
      const size = s.size.trim();
      if (!size) {
        await notice("请填写尺码");
        return;
      }
      const specKey = `${nextColor}\u0000${size}`;
      if (specKeys.has(specKey)) {
        await notice("尺码重复", `尺码 ${size} 已存在`);
        return;
      }
      specKeys.add(specKey);
      const stock = Number(s.stock);
      if (!Number.isInteger(stock) || stock < 0) {
        await notice("库存有误", `${size}`);
        return;
      }
      if (s.isNew) {
        addInputs.push({
          color: nextColor,
          size,
          costPrice: costCents ?? 0,
          salePrice: saleCents,
          initialStock: stock,
        });
        continue;
      }
      // 既有行：统一颜色/价格与原值不同才下发；尺码/库存始终带
      const prev = prevById.get(s.id);
      const input: UpdateSkuInput = { id: s.id, stock };
      if (size !== prev?.size) input.size = size;
      if (prev && nextColor !== prev.color) input.color = nextColor;
      if (prev && costCents !== null && costCents !== prev.costPrice) input.costPrice = costCents;
      if (prev && saleCents !== prev.salePrice) input.salePrice = saleCents;
      skuInputs.push(input);
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
        addSkus: addInputs.length > 0 ? addInputs : undefined,
        removeSkuIds: removeIds.length > 0 ? removeIds : undefined,
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
  /** 颜色单选芯片：预设 + 当前自定义值 */
  const editColorChips = (() => {
    const all = [...COLOR_PRESETS];
    if (colorSel && !all.includes(colorSel)) all.push(colorSel);
    return all;
  })();
  /** 输入中的会员价（分）；只读态与编辑态共用（hydrate 后即 skus[0] 值） */
  const saleCents = yuanToCents(salePrice);
  /** 历史多色商品：行标签带颜色前缀；单色商品仅显示尺码 */
  const singleColor = new Set(savedRef.current.skus.map((s) => s.color)).size <= 1;

  function addCustomColor() {
    const v = customColor.trim();
    if (!v) return;
    setColorSel(v.slice(0, 6));
    setCustomColor("");
  }

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
                  onSubmitEditing={addCustomCategory}
                />
                <Pressable style={styles.miniAdd} onPress={addCustomCategory}>
                  <Text style={styles.miniAddText}>+</Text>
                </Pressable>
              </View>

              {/* 单颜色模型：颜色为商品级单选，保存时统一应用到全部 SKU */}
              <View style={styles.pickerHeader}>
                <Text style={styles.sectionTitle}>颜色（单选）</Text>
              </View>
              <View style={styles.chips}>
                {editColorChips.map((c) => (
                  <Chip
                    key={c}
                    label={c}
                    active={colorSel === c}
                    onPress={() => setColorSel(colorSel === c ? "" : c)}
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
                  onSubmitEditing={addCustomColor}
                />
                <Pressable style={styles.miniAdd} onPress={addCustomColor}>
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
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>颜色</Text>
                <Text style={styles.infoValue}>{colorSel || "—"}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>价格</Text>
                <Text style={styles.infoValue}>
                  {saleCents === null
                    ? "—"
                    : `会员 ${yuan(saleCents)} · 原价 ${yuan(memberPriceToTagPrice(saleCents))}`}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* 价格卡：进价/会员价全商品统一 */}
        {editing ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>价格</Text>
            <View style={styles.skuPriceRow}>
              <View style={styles.fieldGrow}>
                <Text style={styles.fieldLabel} numberOfLines={1} adjustsFontSizeToFit>
                  进价(元)
                </Text>
                <TextInput
                  style={styles.fieldInput}
                  keyboardType="decimal-pad"
                  value={costPrice}
                  onChangeText={setCostPrice}
                />
              </View>
              <View style={styles.fieldGrow}>
                <Text style={styles.fieldLabel} numberOfLines={1} adjustsFontSizeToFit>
                  会员价(元)
                </Text>
                <TextInput
                  style={styles.fieldInput}
                  keyboardType="decimal-pad"
                  value={salePrice}
                  onChangeText={setSalePrice}
                />
                <Text style={styles.tagPriceHint} numberOfLines={1}>
                  原价 {saleCents === null ? "—" : yuan(memberPriceToTagPrice(saleCents))}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.sizeHeader}>
            <Text style={styles.sectionTitle}>尺码与库存</Text>
            {editing ? (
              <Pressable
                style={styles.addSizeBtn}
                onPress={() => setAddPicker({ pick: "", qty: "1" })}
                accessibilityRole="button"
                accessibilityLabel="新增尺码"
                hitSlop={10}
              >
                <Ionicons name="add" size={12} color="#fff" />
              </Pressable>
            ) : null}
          </View>
          {skus.map((s, idx) =>
            editing ? (
              /* 编辑行：尺码按钮（弹层改码/删除）+ 库存步进器，交互与建档一致 */
              <View
                key={s.id}
                style={[styles.skuEditRow, idx === skus.length - 1 && styles.skuEditRowLast]}
              >
                <Pressable
                  style={styles.skuSizeBtn}
                  onPress={() => setEditPicker({ draftId: s.id, pick: s.size })}
                  accessibilityRole="button"
                  accessibilityLabel={`修改尺码 ${s.size}`}
                >
                  <Text style={styles.skuSizeBtnText} numberOfLines={1}>
                    {s.size}
                  </Text>
                </Pressable>
                <View style={styles.qtyStepper}>
                  <Pressable
                    style={styles.qtyBtn}
                    onPress={() => bumpStock(s.id, -1)}
                    accessibilityRole="button"
                    accessibilityLabel={`减少 ${s.size} 库存`}
                    hitSlop={6}
                  >
                    <Ionicons name="remove" size={15} color={colors.primary} />
                  </Pressable>
                  <TextInput
                    style={styles.qtyInput}
                    keyboardType="number-pad"
                    value={s.stock}
                    onChangeText={(t) => setStockRaw(s.id, t)}
                    onBlur={() => setStockRaw(s.id, s.stock || "0")}
                  />
                  <Pressable
                    style={styles.qtyBtn}
                    onPress={() => bumpStock(s.id, 1)}
                    accessibilityRole="button"
                    accessibilityLabel={`增加 ${s.size} 库存`}
                    hitSlop={6}
                  >
                    <Ionicons name="add" size={15} color={colors.primary} />
                  </Pressable>
                </View>
              </View>
            ) : (
              savedRef.current.skus.map((s) => (
                <View key={s.id} style={styles.skuRow}>
                  <Text style={styles.skuSpec}>
                    {singleColor ? s.size : `${s.color}/${s.size}`}
                  </Text>
                  <Text style={styles.skuStock}>库存 {s.stock}</Text>
                </View>
              ))
            ),
          )}
        </View>

        {/* 尺码编辑弹层：三组+均码单选；保存=改码，删除=删该码（软删），取消 */}
        <Modal
          visible={!!editPicker}
          transparent
          animationType="none"
          onRequestClose={() => setEditPicker(null)}
        >
          <Pressable style={styles.pickerBackdrop} onPress={() => setEditPicker(null)} />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.pickerCenter}
          >
            <View style={styles.pickerSheet}>
              <Text style={styles.pickerTitle}>选择尺码</Text>
              <ScrollView style={styles.pickerScroll}>
                <View style={styles.chips}>
                  <Chip
                    key="均码"
                    label="均码"
                    active={editPicker?.pick === "均码"}
                    onPress={() =>
                      editPicker && setEditPicker({ ...editPicker, pick: "均码", err: undefined })
                    }
                  />
                </View>
                {PRESET_SIZE_GROUPS.map((g) => (
                  <View key={g.label}>
                    <Text style={styles.pickerGroupLabel}>{g.label}</Text>
                    <View style={styles.chips}>
                      {g.sizes.map((sz) => (
                        <Chip
                          key={sz}
                          label={sz}
                          active={editPicker?.pick === sz}
                          onPress={() =>
                            editPicker && setEditPicker({ ...editPicker, pick: sz, err: undefined })
                          }
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </ScrollView>
              {editPicker?.err ? <Text style={styles.pickerErr}>{editPicker.err}</Text> : null}
              <View style={styles.pickerActions}>
                <Pressable
                  style={styles.pickerDangerBtn}
                  onPress={() => editPicker && removeDraft(editPicker.draftId)}
                >
                  <Text style={styles.pickerDangerText}>删除</Text>
                </Pressable>
                <Pressable style={styles.pickerSecondaryBtn} onPress={() => setEditPicker(null)}>
                  <Text style={styles.pickerSecondaryText}>取消</Text>
                </Pressable>
                <Pressable style={styles.pickerPrimaryBtn} onPress={confirmEditSize}>
                  <Text style={styles.pickerPrimaryText}>保存</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* 新增尺码弹层：选尺码 + 初始库存；添加/取消 */}
        <Modal
          visible={!!addPicker}
          transparent
          animationType="none"
          onRequestClose={() => setAddPicker(null)}
        >
          <Pressable style={styles.pickerBackdrop} onPress={() => setAddPicker(null)} />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.pickerCenter}
          >
            <View style={styles.pickerSheet}>
              <Text style={styles.pickerTitle}>新增尺码</Text>
              <ScrollView style={styles.pickerScroll}>
                <View style={styles.chips}>
                  <Chip
                    key="均码"
                    label="均码"
                    active={addPicker?.pick === "均码"}
                    onPress={() =>
                      addPicker && setAddPicker({ ...addPicker, pick: "均码", err: undefined })
                    }
                  />
                </View>
                {PRESET_SIZE_GROUPS.map((g) => (
                  <View key={g.label}>
                    <Text style={styles.pickerGroupLabel}>{g.label}</Text>
                    <View style={styles.chips}>
                      {g.sizes.map((sz) => (
                        <Chip
                          key={sz}
                          label={sz}
                          active={addPicker?.pick === sz}
                          onPress={() =>
                            addPicker && setAddPicker({ ...addPicker, pick: sz, err: undefined })
                          }
                        />
                      ))}
                    </View>
                  </View>
                ))}
                {/* 初始库存步进（与建档交互一致） */}
                <View style={styles.addQtyRow}>
                  <Text style={styles.addQtyLabel}>入库数量</Text>
                  <View style={styles.qtyStepper}>
                    <Pressable
                      style={styles.qtyBtn}
                      onPress={() => bumpAddQty(-1)}
                      accessibilityRole="button"
                      accessibilityLabel="减少数量"
                      hitSlop={6}
                    >
                      <Ionicons name="remove" size={15} color={colors.primary} />
                    </Pressable>
                    <TextInput
                      style={styles.qtyInput}
                      keyboardType="number-pad"
                      value={addPicker?.qty ?? "1"}
                      onChangeText={(t) =>
                        addPicker &&
                        setAddPicker({
                          ...addPicker,
                          qty: t.replace(/[^0-9]/g, "").slice(0, 4),
                          err: undefined,
                        })
                      }
                    />
                    <Pressable
                      style={styles.qtyBtn}
                      onPress={() => bumpAddQty(1)}
                      accessibilityRole="button"
                      accessibilityLabel="增加数量"
                      hitSlop={6}
                    >
                      <Ionicons name="add" size={15} color={colors.primary} />
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
              {addPicker?.err ? <Text style={styles.pickerErr}>{addPicker.err}</Text> : null}
              <View style={styles.pickerActions}>
                <Pressable style={styles.pickerSecondaryBtn} onPress={() => setAddPicker(null)}>
                  <Text style={styles.pickerSecondaryText}>取消</Text>
                </Pressable>
                <Pressable style={styles.pickerPrimaryBtn} onPress={confirmAddSize}>
                  <Text style={styles.pickerPrimaryText}>添加</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

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
  /** 尺码卡标题行：标题钉在左上角（与其他卡片标题平齐），右侧小圆钮不撑高、不挤占标题；
   *  marginBottom 让首个尺码行与标题留出呼吸距离 */
  sizeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  /** 卡片标题行的「+」小圆形图标按钮（新增尺码）；marginTop 与标题文字一致，保证中心对齐 */
  addSizeBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  /** 编辑态 SKU 行：尺码按钮 + 库存步进器 */
  skuEditRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  skuEditRowLast: { borderBottomWidth: 0 },
  /** 尺码胶囊按键：内容居中，点击弹二级选择（改码/删除） */
  skuSizeBtn: {
    minWidth: 64,
    height: 36,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  skuSizeBtnText: { fontSize: font.body, fontWeight: "700", color: colors.text },
  /** 库存步进器（与建档一致） */
  qtyStepper: { flexDirection: "row", alignItems: "center", gap: 6 },
  qtyBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyInput: {
    width: 64,
    height: 36,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    textAlign: "center",
    fontSize: font.body,
    fontWeight: "700",
    color: colors.text,
    paddingVertical: 0,
    includeFontPadding: false,
  },
  skuEditTitle: { fontSize: font.body, fontWeight: "700", color: colors.text, marginBottom: 4 },
  /** 尺码弹层（编辑/新增共用）：遮罩 + 居中卡片 */
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(13,22,44,0.45)",
  },
  pickerCenter: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  pickerSheet: {
    width: "100%",
    maxHeight: "78%",
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    padding: space.lg,
    gap: space.sm,
  },
  pickerTitle: {
    fontSize: font.title,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  pickerScroll: { flexGrow: 0 },
  pickerGroupLabel: {
    fontSize: font.caption,
    color: colors.textMuted,
    fontWeight: "700",
    marginTop: space.sm,
  },
  pickerErr: {
    fontSize: font.caption,
    fontWeight: "700",
    color: colors.danger,
    textAlign: "center",
  },
  pickerActions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  pickerDangerBtn: {
    height: 46,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerDangerText: { fontSize: font.body, fontWeight: "700", color: colors.danger },
  pickerSecondaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerSecondaryText: { fontSize: font.body, fontWeight: "700", color: colors.textMuted },
  pickerPrimaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerPrimaryText: { fontSize: font.body, fontWeight: "800", color: "#fff" },
  /** 新增弹层的入库数量行 */
  addQtyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.md,
  },
  addQtyLabel: { fontSize: font.body, fontWeight: "700", color: colors.text },
  skuSpec: { flex: 1, fontSize: font.body, fontWeight: "600", color: colors.text },
  skuViewRight: { alignItems: "flex-end", gap: 2 },
  skuStock: { fontSize: font.caption, color: colors.textMuted },
  skuPriceRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  fieldGrow: { flex: 1, minWidth: 0, gap: 4 },
  /** 会员价输入框下方的只读原价提示 */
  tagPriceHint: { fontSize: 11, lineHeight: 14, color: colors.gold, fontWeight: "700" },
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
