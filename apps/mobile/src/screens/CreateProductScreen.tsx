import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  CreateProductInput,
  expandSkuMatrix,
  HOT_CATEGORY_COUNT,
  HOT_MATERIAL_COUNT,
  memberPriceToTagPrice,
  normalizeProductTitle,
  PRESET_CATEGORIES,
  PRESET_COLORS,
  PRESET_MATERIALS,
  PRESET_SIZE_GROUPS,
  SYSTEM_COLORS,
  VISION_ERROR_MESSAGES,
  type RecognizeGarmentResult,
} from "@cloth-scan/shared";
import { ApiError, createProduct, recognizeGarment, uploadImage } from "../api";
import { useAuth } from "../auth-context";
import { BackButton } from "../components/BackButton";
import { useDialog } from "../dialog-context";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space, touch } from "../theme/tokens";
import { yuan } from "../utils/format";
import { isPickerCancelled, pickProductImage } from "../utils/image-pick";
import { useKeyboardHeight, useKeyboardReveal } from "../utils/kb";
import { Chip } from "./create-product/Chip";
import { PhotoSlots, type PhotoKey } from "./create-product/PhotoSlots";
import { PhotoSourceSheet } from "./create-product/PhotoSourceSheet";
import { VisionReviewModal, type VisionDraft } from "./create-product/VisionReviewModal";

type CreateProductNav = NativeStackNavigationProp<RootStackParamList, "CreateProduct">;
type Mode = "entry" | "manual";

function toCents(yuan: string): number {
  const n = Number(yuan);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function CreateProductScreen() {
  const navigation = useNavigation<CreateProductNav>();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const { notice } = useDialog();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("entry");
  const [fromVision, setFromVision] = useState(false);

  const [photos, setPhotos] = useState<Record<PhotoKey, string | null>>({
    front: null,
    back: null,
    detail: null,
  });
  const [uploadingKey, setUploadingKey] = useState<PhotoKey | null>(null);
  const [pickingKey, setPickingKey] = useState<PhotoKey | null>(null);

  const [material, setMaterial] = useState("默认");
  const [category, setCategory] = useState("");
  const [extraMaterials, setExtraMaterials] = useState<string[]>([]);
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [customMaterial, setCustomMaterial] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [materialsExpanded, setMaterialsExpanded] = useState(false);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);

  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  // 建档模型：单颜色（商品级）× 多尺码；颜色/进价/会员价全商品统一，仅尺码库存各异
  const [colorSel, setColorSel] = useState("");
  const [customColor, setCustomColor] = useState("");
  const [sizes, setSizes] = useState<string[]>(["均码"]);
  /** 各尺码初始库存（输入原始文本，默认 "1"；提交时统一校验） */
  const [sizeQty, setSizeQty] = useState<Record<string, string>>({ 均码: "1" });

  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 提交校验错误：红色提示显示在对应卡片底部，并自动滚动到该卡片 */
  const [fieldErr, setFieldErr] = useState<{
    field: "photos" | "name" | "price" | "sizes";
    msg: string;
  } | null>(null);

  const [recognizing, setRecognizing] = useState(false);
  const [overlayText, setOverlayText] = useState("正在识别正面图…");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [aiResult, setAiResult] = useState<RecognizeGarmentResult | null>(null);
  const [visionError, setVisionError] = useState<{
    message: string;
    canRetry: boolean;
  } | null>(null);

  const photosFull = Boolean(photos.front && photos.back && photos.detail);
  /** 商品唯一颜色；未选回落「默认」 */
  const effColor = colorSel.trim() || "默认";
  /** 已勾选的尺码即全部尺码（减到 0 会自动取消勾选，不再回落「均码」） */
  const effSizes = sizes;
  const sizeCount = effSizes.length;
  const sizeQtyOf = (s: string) => sizeQty[s] ?? "1";
  const totalStock = effSizes.reduce((sum, s) => sum + (Number(sizeQtyOf(s)) || 0), 0);

  function composeName(nextMaterial: string, nextCategory: string) {
    const m = nextMaterial === "默认" ? "" : nextMaterial;
    return `${m}${nextCategory}`;
  }

  function selectMaterial(m: string) {
    const next = material === m ? "" : m;
    setMaterial(next);
    if (!nameTouched) setName(composeName(next, category));
  }
  function selectCategory(c: string) {
    const next = category === c ? "" : c;
    setCategory(next);
    if (!nameTouched) setName(composeName(material, next));
  }

  /** 勾选/取消尺码：新勾选的尺码初始化库存输入为 1 */
  function toggleSize(s: string) {
    setSizes((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));
    setSizeQty((m) => (m[s] ? m : { ...m, [s]: "1" }));
    setFieldErr(null);
  }

  /** 尺码库存输入：只留数字，最长 4 位 */
  function setQtyRaw(s: string, raw: string) {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 4);
    setSizeQty((m) => ({ ...m, [s]: digits }));
  }

  /** 步进调整：减到 0 视为不要该尺码，直接取消勾选（库存行一并收起） */
  function bumpQty(s: string, delta: number) {
    const cur = Number(sizeQtyOf(s)) || 0;
    const next = Math.max(0, Math.min(9_999, cur + delta));
    if (next <= 0) {
      setSizes((list) => list.filter((x) => x !== s));
      return;
    }
    setQtyRaw(s, String(next));
  }

  function addCustomMaterial() {
    const v = customMaterial.trim();
    if (!v) return;
    if (!(PRESET_MATERIALS as readonly string[]).includes(v) && !extraMaterials.includes(v)) {
      setExtraMaterials((prev) => [...prev, v]);
    }
    setCustomMaterial("");
    selectMaterial(v);
  }
  function addCustomCategory() {
    const v = customCategory.trim();
    if (!v) return;
    if (!(PRESET_CATEGORIES as readonly string[]).includes(v) && !extraCategories.includes(v)) {
      setExtraCategories((prev) => [...prev, v]);
    }
    setCustomCategory("");
    selectCategory(v);
  }

  /** 自定义颜色：直接选中为商品唯一颜色 */
  function addCustomColor() {
    const v = customColor.trim();
    if (!v) return;
    setColorSel(v.slice(0, 6));
    setCustomColor("");
  }

  function pickImage(key: PhotoKey) {
    setPickingKey(key);
  }

  async function pickFrom(key: PhotoKey, fromCamera: boolean) {
    setError(null);
    let uri: string;
    try {
      uri = await pickProductImage(fromCamera);
    } catch (e) {
      if (!isPickerCancelled(e)) setError(fromCamera ? "无法使用相机" : "无法访问相册");
      return;
    }
    setUploadingKey(key);
    try {
      const path = await uploadImage(uri);
      setPhotos((p) => ({ ...p, [key]: path }));
    } catch (e) {
      setError(`图片上传失败：${(e as Error).message}`);
    } finally {
      setUploadingKey(null);
    }
  }

  function goManual() {
    setMode("manual");
    setReviewOpen(false);
    setVisionError(null);
  }

  async function runRecognize() {
    if (!photos.front || !photos.back || !photos.detail) {
      return;
    }
    setVisionError(null);
    setError(null);
    setRecognizing(true);
    setOverlayText("正在识别正面图…");
    const started = Date.now();
    try {
      const result = await recognizeGarment(photos.front);
      setAiResult(result);
      setReviewOpen(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const err = e as ApiError;
      const code = err.code;
      const fatal = code === "invalid_key" || code === "quota" || code === "unsafe";
      const message =
        (code && code in VISION_ERROR_MESSAGES
          ? VISION_ERROR_MESSAGES[code as keyof typeof VISION_ERROR_MESSAGES]
          : null) ??
        err.message ??
        VISION_ERROR_MESSAGES.retry_exhausted;
      setVisionError({ message, canRetry: !fatal });
      setError(message);
    } finally {
      const wait = 600 - (Date.now() - started);
      if (wait > 0) await sleep(wait);
      setRecognizing(false);
    }
  }

  function applyVisionDraft(draft: VisionDraft) {
    setName(draft.name);
    setNameTouched(Boolean(draft.name));
    setCategory(draft.category);
    if (
      draft.category &&
      !(PRESET_CATEGORIES as readonly string[]).includes(draft.category) &&
      !extraCategories.includes(draft.category)
    ) {
      setExtraCategories((p) => [...p, draft.category]);
    }
    // 单颜色模型：识图多色候选取第一个
    setColorSel(draft.colors[0] ?? "");
    setFromVision(true);
    setMode("manual");
    setReviewOpen(false);
  }

  const preview = useMemo(() => {
    const shown = name.trim() || composeName(material, category) || "（待填写名称）";
    return `「${shown}」· ${effColor} · ${sizeCount} 个尺码 共 ${totalStock} 件`;
  }, [effColor, sizeCount, totalStock, name, material, category]);

  async function submit() {
    setError(null);
    setFieldErr(null);

    /** 校验失败：错误显示在对应卡片底部并自动滚过去（用户不必翻页找原因） */
    const fail = (field: "photos" | "name" | "price" | "sizes", msg: string) => {
      setFieldErr({ field, msg });
      const y = cardYRef.current[field] ?? 0;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 72), animated: true });
    };

    if (!photos.front || !photos.back || !photos.detail) {
      return fail("photos", "请拍完三张图");
    }
    const cost = !isOwner ? 0 : costPrice.trim() === "" ? 0 : toCents(costPrice);
    const sale = salePrice.trim() === "" ? NaN : toCents(salePrice);

    if (Number.isNaN(sale)) return fail("price", "请填写有效的会员价");
    if (Number.isNaN(cost) || cost < 0) return fail("price", "进价格式有误");

    if (effSizes.length === 0) {
      return fail("sizes", "请至少勾选一个尺码并为各尺码填写库存");
    }

    // 逐尺码库存：全部非负整数，且至少入库 1 件
    const stockBySize: Record<string, number> = {};
    for (const s of effSizes) {
      const n = Number(sizeQtyOf(s));
      if (!Number.isInteger(n) || n < 0) {
        return fail("sizes", `尺码 ${s} 的库存需为非负整数`);
      }
      stockBySize[s] = n;
    }
    if (Object.values(stockBySize).reduce((a, b) => a + b, 0) <= 0) {
      return fail("sizes", "至少入库 1 件，请为各尺码填写库存");
    }

    const autoName = name.trim() || composeName(material, category);
    if (!autoName) {
      return fail("name", "请填写商品名称或选择品类");
    }
    const finalName = normalizeProductTitle(autoName, effColor, category);
    if (finalName.length < 5) {
      return fail("name", "请填写商品名称或选择品类");
    }

    // 单颜色 × 多尺码：颜色/进价/会员价全商品统一，各尺码库存独立
    const skus = expandSkuMatrix({
      colors: [effColor],
      sizes: effSizes,
      costPrice: cost,
      salePrice: sale,
      initialStockBySize: stockBySize,
    });

    const images = [photos.front, photos.back, photos.detail];
    const payload = {
      name: finalName,
      coverImage: photos.front,
      images,
      material: material || "默认",
      categoryName: category || undefined,
      skus,
    };
    const parsed = CreateProductInput.safeParse(payload);
    if (!parsed.success) {
      return setError(parsed.error.issues[0]?.message ?? "参数有误");
    }

    setSubmitting(true);
    try {
      const product = await createProduct(parsed.data);
      await notice("已建档", product.name);
      navigation.reset({
        index: 1,
        routes: [{ name: "Home" }, { name: "Products" }],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
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

  // 单颜色模型：预设 + 已选的自定义值（不再多选展开）
  const colorChips = [
    ...new Set([
      ...PRESET_COLORS,
      ...SYSTEM_COLORS,
      ...(colorSel &&
      !(PRESET_COLORS as readonly string[]).includes(colorSel) &&
      !(SYSTEM_COLORS as readonly string[]).includes(colorSel)
        ? [colorSel]
        : []),
    ]),
  ];
  // 会员价输入实时推导原价（÷0.8 四舍五入到元）；空输入/非法输入显示 —
  // （toCents("") 会因 Number("")===0 返回 0，须先排除空串）
  const saleCents = salePrice.trim() === "" ? NaN : toCents(salePrice);
  const tagPriceText = Number.isNaN(saleCents)
    ? "原价 —"
    : `原价 ${yuan(memberPriceToTagPrice(saleCents))}`;

  const saveDisabled = submitting || salePrice.trim() === "" || !photosFull;
  const entryDisabled = !photosFull || !!uploadingKey;

  // 键盘避让：数字输入框聚焦时滚入可视区（Android resize 后 ScrollView 不自动跟随焦点）
  const scrollRef = useRef<ScrollView>(null);
  // 各卡片在滚动区内的 y 坐标（onLayout 记录），供校验失败时自动滚动定位
  const cardYRef = useRef<Record<string, number>>({});
  const recordCardY =
    (key: string) =>
    ({ nativeEvent }: LayoutChangeEvent): void => {
      cardYRef.current[key] = nativeEvent.layout.y;
    };
  const scrollYRef = useRef(0);
  const kbPad = useKeyboardHeight();
  // 全量键盘避让：keyboardDidShow 后按「此刻聚焦」的输入框补位（免逐字段接线，无陈旧目标）
  useKeyboardReveal(scrollRef, () => scrollYRef.current);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.bodyWrap}>
        <View style={styles.topbar}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={styles.title}>商品建档</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          onScroll={(e) => {
            scrollYRef.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.content, { paddingBottom: 24 + kbPad }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card} onLayout={recordCardY("photos")}>
            <Text style={styles.sectionTitle}>商品照片</Text>
            <PhotoSlots photos={photos} uploadingKey={uploadingKey} onPressSlot={pickImage} />
            {fieldErr?.field === "photos" ? (
              <Text style={styles.fieldErrText}>{fieldErr.msg}</Text>
            ) : null}
          </View>

          <View style={styles.card} onLayout={recordCardY("price")}>
            <Text style={styles.sectionTitle}>价格</Text>
            <View style={styles.row}>
              {isOwner ? (
                <View style={styles.priceCol}>
                  <Text
                    style={styles.fieldLabel}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    进价(元)
                  </Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    placeholder="选填"
                    placeholderTextColor={colors.textMuted}
                    value={costPrice}
                    onChangeText={setCostPrice}
                  />
                </View>
              ) : null}
              <View style={styles.priceCol}>
                <Text
                  style={styles.fieldLabel}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  会员价(元)
                </Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="必填"
                  placeholderTextColor={colors.textMuted}
                  value={salePrice}
                  onChangeText={(t) => {
                    setSalePrice(t);
                    if (fieldErr?.field === "price") setFieldErr(null);
                  }}
                />
                {/* 原价只读自动推导：原价 = 会员价 ÷ 0.8（四舍五入到元），顾客看原价、会员打 8 折 */}
                <Text style={styles.tagPriceHint} numberOfLines={1}>
                  {tagPriceText}
                </Text>
              </View>
            </View>
            {fieldErr?.field === "price" ? (
              <Text style={styles.fieldErrText}>{fieldErr.msg}</Text>
            ) : null}
          </View>

          <View style={styles.card} onLayout={recordCardY("sizes")}>
            <View style={styles.pickerHeader}>
              <Text style={styles.sectionTitle}>材质</Text>
              {PRESET_MATERIALS.length > HOT_MATERIAL_COUNT ? (
                <Pressable onPress={() => setMaterialsExpanded((v) => !v)} hitSlop={8}>
                  <Text style={styles.expand}>{materialsExpanded ? "收起" : "更多"}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.chips}>
              {materialChips.map((m) => (
                <Chip key={m} label={m} active={material === m} onPress={() => selectMaterial(m)} />
              ))}
            </View>
            <View style={styles.addRow}>
              <TextInput
                style={[styles.input, styles.flex1, styles.mini]}
                placeholder="自定义材质"
                placeholderTextColor={colors.textMuted}
                value={customMaterial}
                onChangeText={setCustomMaterial}
                onSubmitEditing={addCustomMaterial}
              />
              <Pressable style={styles.miniAdd} onPress={addCustomMaterial}>
                <Text style={styles.miniAddText}>+</Text>
              </Pressable>
            </View>

            <View style={styles.pickerHeader}>
              <Text style={styles.sectionTitle}>尺码</Text>
              <Text style={styles.sizeTotal}>共 {totalStock} 件</Text>
            </View>
            {/* 均码置顶（默认选中）+ 三组预设分区；尺码仅从预设中选，不再支持自定义 */}
            <View style={styles.chips}>
              <Chip
                key="均码"
                label="均码"
                active={sizes.includes("均码")}
                onPress={() => toggleSize("均码")}
              />
            </View>
            {PRESET_SIZE_GROUPS.map((g) => (
              <View key={g.label}>
                <Text style={styles.sizeGroupLabel}>{g.label}</Text>
                <View style={styles.chips}>
                  {g.sizes.map((s) => (
                    <Chip
                      key={s}
                      label={s}
                      active={sizes.includes(s)}
                      onPress={() => toggleSize(s)}
                    />
                  ))}
                </View>
              </View>
            ))}

            {/* 已选尺码逐码填库存：一行 = 尺码 + 数量步进；减到 0 自动取消勾选 */}
            {effSizes.length > 0 ? (
              <View style={styles.sizeQtyList}>
                {effSizes.map((s) => (
                  <View key={s} style={styles.sizeQtyRow}>
                    <Text style={styles.sizeQtyLabel} numberOfLines={1}>
                      {s}
                    </Text>
                    <View style={styles.qtyStepper}>
                      <Pressable
                        style={styles.qtyBtn}
                        onPress={() => bumpQty(s, -1)}
                        accessibilityRole="button"
                        accessibilityLabel={`减少 ${s} 库存`}
                        hitSlop={6}
                      >
                        <Ionicons name="remove" size={15} color={colors.primary} />
                      </Pressable>
                      <TextInput
                        style={styles.qtyInput}
                        keyboardType="number-pad"
                        value={sizeQtyOf(s)}
                        onChangeText={(t) => setQtyRaw(s, t)}
                        onBlur={() => {
                          // 手动清零/置空同减到 0：视为不要该尺码，取消勾选
                          if ((Number(sizeQtyOf(s)) || 0) <= 0) {
                            setSizes((list) => list.filter((x) => x !== s));
                          }
                        }}
                      />
                      <Pressable
                        style={styles.qtyBtn}
                        onPress={() => bumpQty(s, 1)}
                        accessibilityRole="button"
                        accessibilityLabel={`增加 ${s} 库存`}
                        hitSlop={6}
                      >
                        <Ionicons name="add" size={15} color={colors.primary} />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
            {fieldErr?.field === "sizes" ? (
              <Text style={styles.fieldErrText}>{fieldErr.msg}</Text>
            ) : null}
          </View>

          {mode === "manual" ? (
            <View style={styles.card} onLayout={recordCardY("name")}>
              <Text style={styles.sectionTitle}>名称</Text>
              <TextInput
                style={styles.input}
                placeholder="商品名称"
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={(t) => {
                  setNameTouched(true);
                  setName(t);
                  if (fieldErr?.field === "name") setFieldErr(null);
                }}
                maxLength={60}
              />
              {fieldErr?.field === "name" ? (
                <Text style={styles.fieldErrText}>{fieldErr.msg}</Text>
              ) : null}

              <View style={styles.pickerHeader}>
                <Text style={styles.sectionTitle}>品类</Text>
                {PRESET_CATEGORIES.length > HOT_CATEGORY_COUNT ? (
                  <Pressable onPress={() => setCategoriesExpanded((v) => !v)} hitSlop={8}>
                    <Text style={styles.expand}>{categoriesExpanded ? "收起" : "更多"}</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.chips}>
                {categoryChips.map((c) => (
                  <Chip
                    key={c}
                    label={c}
                    active={category === c}
                    onPress={() => selectCategory(c)}
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

              <Text style={[styles.sectionTitle, { marginTop: space.md }]}>颜色（单选）</Text>
              <View style={styles.chips}>
                {colorChips.map((c) => (
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
            </View>
          ) : null}

          {mode === "manual" ? <Text style={styles.preview}>{preview}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {visionError && !recognizing ? (
            <View style={styles.visionErrBox}>
              {visionError.canRetry ? (
                <Pressable style={styles.retryBtn} onPress={() => void runRecognize()}>
                  <Text style={styles.retryText}>重试识别</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.retryBtn} onPress={goManual}>
                  <Text style={styles.retryText}>改用手动入库</Text>
                </Pressable>
              )}
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {mode === "entry" ? (
            <View style={styles.barRow}>
              <Pressable
                style={[styles.primaryBtn, styles.flex1, entryDisabled && styles.btnDisabled]}
                disabled={entryDisabled || recognizing}
                onPress={() => void runRecognize()}
              >
                <Text style={[styles.primaryBtnText, entryDisabled && styles.btnDisabledText]}>
                  AI 入库
                </Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, styles.flex1, entryDisabled && styles.btnDisabled]}
                disabled={entryDisabled}
                onPress={goManual}
              >
                <Text style={[styles.secondaryBtnText, entryDisabled && styles.btnDisabledText]}>
                  手动入库
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.barRow}>
              <Pressable
                style={[
                  styles.secondaryBtn,
                  { flex: 0.38 },
                  (!photosFull || recognizing) && styles.btnDisabled,
                ]}
                disabled={!photosFull || recognizing}
                onPress={() => void runRecognize()}
              >
                <Text
                  style={[
                    styles.secondaryBtnText,
                    (!photosFull || recognizing) && styles.btnDisabledText,
                  ]}
                >
                  {fromVision ? "重新识别" : "AI 入库"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, { flex: 0.62 }, saveDisabled && styles.btnDisabled]}
                disabled={saveDisabled}
                onPress={() => void submit()}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.primaryBtnText, saveDisabled && styles.btnDisabledText]}>
                    确认建档
                  </Text>
                )}
              </Pressable>
            </View>
          )}
        </View>

        <Modal visible={recognizing} transparent animationType="fade">
          <View style={styles.overlay} pointerEvents="auto">
            <View style={styles.overlayCard}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.overlayText}>{overlayText}</Text>
            </View>
          </View>
        </Modal>

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

        <VisionReviewModal
          visible={reviewOpen}
          initial={
            aiResult
              ? { name: aiResult.name, category: aiResult.category, color: aiResult.color }
              : null
          }
          onCancel={() => setReviewOpen(false)}
          onConfirm={applyVisionDraft}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bodyWrap: { flex: 1 },
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
  back: { color: colors.primary, fontSize: font.body, width: 40, fontWeight: "600" },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  scroll: { flex: 1 },
  content: { padding: space.lg, paddingBottom: 48, gap: space.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: 4,
  },
  sectionTitle: { fontSize: font.body, fontWeight: "700", color: colors.text },
  fieldLabel: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    marginTop: space.sm,
    fontWeight: "600",
    includeFontPadding: false,
  },
  /** 会员价输入框下方的只读原价（自动推导 ÷0.8） */
  tagPriceHint: {
    fontSize: font.caption,
    lineHeight: 16,
    color: colors.gold,
    fontWeight: "700",
    marginTop: 4,
    includeFontPadding: false,
  },
  /** 尺码分组小标题（字母码/女装码/裤装码/自定义） */
  sizeGroupLabel: {
    fontSize: font.caption,
    color: colors.textMuted,
    fontWeight: "700",
    marginTop: space.sm,
  },
  /** 尺码区标题右侧的总件数 */
  sizeTotal: { fontSize: font.caption, fontWeight: "800", color: colors.primary },
  /** 校验失败的就近红色提示（卡片底部） */
  fieldErrText: {
    fontSize: font.caption + 1,
    fontWeight: "700",
    color: colors.danger,
    marginTop: 8,
  },
  /** 已选尺码的逐码库存清单 */
  sizeQtyList: {
    marginTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.sm,
    gap: 8,
  },
  sizeQtyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 40,
  },
  sizeQtyLabel: { fontSize: font.body + 1, fontWeight: "800", color: colors.text, flexShrink: 1 },
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
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.bg,
    marginTop: 6,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  mini: { paddingVertical: 9, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.sm,
  },
  expand: { fontSize: font.caption, color: colors.primary, fontWeight: "700" },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
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
  row: { flexDirection: "row", gap: 8 },
  flex1: { flex: 1 },
  priceCol: { flex: 1, minWidth: 0 },
  preview: {
    fontSize: font.caption,
    color: colors.primary,
    fontWeight: "600",
    paddingHorizontal: 4,
  },
  error: { color: colors.danger, fontSize: font.body, paddingHorizontal: 4 },
  visionErrBox: { paddingHorizontal: 4 },
  retryBtn: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  retryText: { color: colors.primary, fontWeight: "700", fontSize: font.body },
  bottomBar: {
    backgroundColor: colors.card,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 8,
  },
  barRow: { flexDirection: "row", gap: 10 },
  primaryBtn: {
    height: touch.buttonHeight,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: font.body, fontWeight: "800" },
  secondaryBtn: {
    height: touch.buttonHeight,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  secondaryBtnText: { color: colors.primary, fontSize: font.body, fontWeight: "700" },
  btnDisabled: {
    backgroundColor: "#EEF0F3",
    borderColor: "#EEF0F3",
    opacity: 1,
  },
  btnDisabledText: { color: "#9CA3AF" },
  overlay: {
    flex: 1,
    backgroundColor: colors.backdrop,
    alignItems: "center",
    justifyContent: "center",
  },
  overlayCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: "center",
    gap: 14,
    minWidth: 220,
  },
  overlayText: { fontSize: font.body, color: colors.text, fontWeight: "600" },
});
