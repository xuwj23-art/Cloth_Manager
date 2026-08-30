import { useMemo, useRef, useState, type MutableRefObject } from "react";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import {
  CreateProductInput,
  expandSkuMatrix,
  HOT_CATEGORY_COUNT,
  HOT_MATERIAL_COUNT,
  normalizeProductTitle,
  PRESET_CATEGORIES,
  PRESET_COLORS,
  PRESET_MATERIALS,
  PRESET_SIZES,
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
import { isPickerCancelled, pickProductImage } from "../utils/image-pick";
import { makeReveal, useKeyboardHeight, useKeyboardReveal } from "../utils/kb";
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

  const [colorsSel, setColorsSel] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>(["均码"]);
  const [customColor, setCustomColor] = useState("");
  const [customSize, setCustomSize] = useState("");

  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [initialStock, setInitialStock] = useState("1");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recognizing, setRecognizing] = useState(false);
  const [overlayText, setOverlayText] = useState("正在识别正面图…");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [aiResult, setAiResult] = useState<RecognizeGarmentResult | null>(null);
  const [visionError, setVisionError] = useState<{
    message: string;
    canRetry: boolean;
  } | null>(null);

  const photosFull = Boolean(photos.front && photos.back && photos.detail);
  const effColors = colorsSel.length ? colorsSel : ["默认"];
  const effSizes = sizes.length ? sizes : ["均码"];
  const skuCount = effColors.length * effSizes.length;

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

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  function addCustom(
    raw: string,
    list: string[],
    setList: (v: string[]) => void,
    clear: () => void,
  ) {
    const v = raw.trim();
    if (v && !list.includes(v)) setList([...list, v]);
    clear();
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
    setColorsSel(draft.colors);
    setFromVision(true);
    setMode("manual");
    setReviewOpen(false);
  }

  const preview = useMemo(() => {
    const specText = `${effColors.join("/")} × ${effSizes.join("/")}`;
    const shown = name.trim() || composeName(material, category) || "（待填写名称）";
    return `「${shown}」· ${skuCount} 个规格（${specText}）`;
  }, [skuCount, effColors, effSizes, name, material, category]);

  async function submit() {
    setError(null);
    if (!photos.front || !photos.back || !photos.detail) {
      return setError("请拍完三张图");
    }
    const cost = !isOwner ? 0 : costPrice.trim() === "" ? 0 : toCents(costPrice);
    const sale = toCents(salePrice);
    const stock = initialStock.trim() === "" ? 0 : Number(initialStock);

    if (Number.isNaN(sale)) return setError("请填写有效的售价");
    if (Number.isNaN(cost) || cost < 0) return setError("进价格式有误");
    if (!Number.isInteger(stock) || stock < 0) return setError("库存需为非负整数");

    const autoName = name.trim() || composeName(material, category);
    if (!autoName) {
      return setError("请填写商品名称或选择品类");
    }
    const finalName = normalizeProductTitle(autoName, effColors[0] ?? "默认", category);
    if (finalName.length < 5) {
      return setError("请填写商品名称或选择品类");
    }

    const skus = expandSkuMatrix({
      colors: effColors,
      sizes: effSizes,
      costPrice: cost,
      salePrice: sale,
      initialStock: stock,
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

  const colorChips = [...new Set([...PRESET_COLORS, ...SYSTEM_COLORS, ...colorsSel])];
  const sizeChips = [...new Set(["均码", ...PRESET_SIZES.filter((s) => s !== "均码"), ...sizes])];

  const saveDisabled = submitting || salePrice.trim() === "" || !photosFull;
  const entryDisabled = !photosFull || !!uploadingKey;

  // 键盘避让：数字输入框聚焦时滚入可视区（Android resize 后 ScrollView 不自动跟随焦点）
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const costRef = useRef<TextInput>(null);
  const saleRef = useRef<TextInput>(null);
  const stockRef = useRef<TextInput>(null);
  const activeRef = useRef<TextInput | null>(null);
  const markActive = (ref: MutableRefObject<TextInput | null>) => () => {
    activeRef.current = ref.current;
  };
  const costReveal = () =>
    makeReveal(
      scrollRef,
      () => scrollYRef.current,
      () => costRef.current,
    )();
  const saleReveal = () =>
    makeReveal(
      scrollRef,
      () => scrollYRef.current,
      () => saleRef.current,
    )();
  const stockReveal = () =>
    makeReveal(
      scrollRef,
      () => scrollYRef.current,
      () => stockRef.current,
    )();

  const kbPad = useKeyboardHeight();
  // 真机可靠路径：键盘完全展开后按活动字段补位
  useKeyboardReveal(
    scrollRef,
    () => scrollYRef.current,
    () => activeRef.current,
  );

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
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>商品照片</Text>
            <PhotoSlots photos={photos} uploadingKey={uploadingKey} onPressSlot={pickImage} />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>价格与库存</Text>
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
                    ref={costRef}
                    onFocus={() => {
                      markActive(costRef)();
                      costReveal();
                    }}
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
                  售价(元)
                </Text>
                <TextInput
                  ref={saleRef}
                  onFocus={() => {
                    markActive(saleRef)();
                    saleReveal();
                  }}
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="必填"
                  placeholderTextColor={colors.textMuted}
                  value={salePrice}
                  onChangeText={setSalePrice}
                />
              </View>
              <View style={styles.priceCol}>
                <Text style={styles.fieldLabel} numberOfLines={1} adjustsFontSizeToFit>
                  库存
                </Text>
                <TextInput
                  ref={stockRef}
                  onFocus={() => {
                    markActive(stockRef)();
                    stockReveal();
                  }}
                  style={styles.input}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor={colors.textMuted}
                  value={initialStock}
                  onChangeText={setInitialStock}
                />
              </View>
            </View>
          </View>

          <View style={styles.card}>
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
            </View>
            <View style={styles.chips}>
              {sizeChips.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  active={sizes.includes(s)}
                  onPress={() => toggle(sizes, setSizes, s)}
                />
              ))}
            </View>
            <View style={styles.addRow}>
              <TextInput
                style={[styles.input, styles.flex1, styles.mini]}
                placeholder="自定义尺码"
                placeholderTextColor={colors.textMuted}
                value={customSize}
                onChangeText={setCustomSize}
                onSubmitEditing={() =>
                  addCustom(customSize, sizes, setSizes, () => setCustomSize(""))
                }
              />
              <Pressable
                style={styles.miniAdd}
                onPress={() => addCustom(customSize, sizes, setSizes, () => setCustomSize(""))}
              >
                <Text style={styles.miniAddText}>+</Text>
              </Pressable>
            </View>
          </View>

          {mode === "manual" ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>名称</Text>
              <TextInput
                style={styles.input}
                placeholder="商品名称"
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={(t) => {
                  setNameTouched(true);
                  setName(t);
                }}
                maxLength={60}
              />

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

              <Text style={[styles.sectionTitle, { marginTop: space.md }]}>颜色</Text>
              <View style={styles.chips}>
                {colorChips.map((c) => (
                  <Chip
                    key={c}
                    label={c}
                    active={colorsSel.includes(c)}
                    onPress={() => toggle(colorsSel, setColorsSel, c)}
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
                  onSubmitEditing={() =>
                    addCustom(customColor, colorsSel, setColorsSel, () => setCustomColor(""))
                  }
                />
                <Pressable
                  style={styles.miniAdd}
                  onPress={() =>
                    addCustom(customColor, colorsSel, setColorsSel, () => setCustomColor(""))
                  }
                >
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
