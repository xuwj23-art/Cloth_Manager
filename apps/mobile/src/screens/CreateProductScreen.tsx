import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { expandSkuMatrix, CreateProductInput } from "@cloth-scan/shared";
import { createProduct, imageUrl, uploadImage } from "../api";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors as themeColors, font, radius, space, touch } from "../theme/tokens";

type CreateProductNav = NativeStackNavigationProp<RootStackParamList, "CreateProduct">;

const PRESET_COLORS = ["黑", "白", "灰", "红", "蓝", "绿", "黄", "粉", "卡其"];
const PRESET_SIZES = ["S", "M", "L", "XL", "XXL", "均码"];

/**
 * 材质（单选）。女装热门排在最前（默认两行展示），其余折叠。
 */
const PRESET_MATERIALS = [
  // —— 热门（默认显示）——
  "纯棉",
  "雪纺",
  "牛仔",
  "针织",
  "真丝",
  "羊毛",
  "蕾丝",
  "莫代尔",
  "棉麻",
  "羊绒",
  // —— 折叠 ——
  "亚麻",
  "苎麻",
  "涤纶",
  "锦纶",
  "氨纶",
  "天丝",
  "粘纤",
  "桑蚕丝",
  "羊羔毛",
  "马海毛",
  "灯芯绒",
  "皮革",
  "麂皮绒",
  "毛呢",
  "法兰绒",
  "珊瑚绒",
  "天鹅绒",
  "丝绒",
  "网纱",
  "醋酸",
  "冰丝",
  "太空棉",
  "罗纹",
  "混纺",
  "化纤",
  "羽绒",
  "皮草",
];

/**
 * 服装品类（单选）。女装热门排在最前（默认两行展示），其余折叠。
 */
const PRESET_CATEGORIES = [
  // —— 热门（默认显示）——
  "连衣裙",
  "T恤",
  "衬衫",
  "卫衣",
  "半身裙",
  "阔腿裤",
  "牛仔裤",
  "针织衫",
  "毛衣",
  "外套",
  // —— 折叠 ——
  "短袖",
  "长袖",
  "Polo衫",
  "打底衫",
  "吊带",
  "背心",
  "马甲",
  "休闲裤",
  "西裤",
  "工装裤",
  "直筒裤",
  "小脚裤",
  "哈伦裤",
  "打底裤",
  "运动裤",
  "卫裤",
  "短裤",
  "五分裤",
  "七分裤",
  "九分裤",
  "背带裤",
  "风衣",
  "大衣",
  "西装",
  "棉服",
  "棉袄",
  "羽绒服",
  "皮衣",
  "套装",
  "连体裤",
  "睡衣套装",
  "内衣",
  "内裤",
  "保暖内衣",
  "围巾",
  "丝巾",
  "袜子",
];

/** 默认展示的热门数量（约两行） */
const HOT_MATERIAL_COUNT = 10;
const HOT_CATEGORY_COUNT = 10;

/** 元 → 分 */
function toCents(yuan: string): number {
  const n = Number(yuan);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

export function CreateProductScreen() {
  const navigation = useNavigation<CreateProductNav>();
  const [name, setName] = useState("");
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // 快速命名：材质 + 品类（各单选，自动组合写入品名）
  const [material, setMaterial] = useState("");
  const [category, setCategory] = useState("");
  const [extraMaterials, setExtraMaterials] = useState<string[]>([]);
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [customMaterial, setCustomMaterial] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [materialsExpanded, setMaterialsExpanded] = useState(false);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  // 详细设置（品名/颜色/尺码）默认折叠：一般服装只填价格库存即可建档
  const [detailExpanded, setDetailExpanded] = useState(false);

  function selectMaterial(m: string) {
    const next = material === m ? "" : m;
    setMaterial(next);
    setName(`${next}${category}`);
  }
  function selectCategory(c: string) {
    const next = category === c ? "" : c;
    setCategory(next);
    setName(`${material}${next}`);
  }
  function addCustomMaterial() {
    const v = customMaterial.trim();
    if (!v) return;
    if (!PRESET_MATERIALS.includes(v) && !extraMaterials.includes(v))
      setExtraMaterials((prev) => [...prev, v]);
    setCustomMaterial("");
    selectMaterial(v);
  }
  function addCustomCategory() {
    const v = customCategory.trim();
    if (!v) return;
    if (!PRESET_CATEGORIES.includes(v) && !extraCategories.includes(v))
      setExtraCategories((prev) => [...prev, v]);
    setCustomCategory("");
    selectCategory(v);
  }

  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [customColor, setCustomColor] = useState("");
  const [customSize, setCustomSize] = useState("");

  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [initialStock, setInitialStock] = useState("1");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 未填写时的默认规格：保证至少生成一个 SKU
  const effColors = colors.length ? colors : ["默认"];
  const effSizes = sizes.length ? sizes : ["均码"];
  const skuCount = effColors.length * effSizes.length;
  const effName = name.trim() || (material || category ? `${material}${category}` : "未命名商品");

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

  async function pickImage(fromCamera: boolean) {
    setError(null);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("需要相册/相机权限");
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (result.canceled || !result.assets?.[0]) return;

    setUploading(true);
    try {
      const path = await uploadImage(result.assets[0].uri);
      setCoverPath(path);
    } catch (e) {
      setError(`图片上传失败：${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  const preview = useMemo(() => {
    const hasSpec = colors.length > 0 || sizes.length > 0;
    const specText = hasSpec ? `${effColors.join("/")} × ${effSizes.join("/")}` : "默认 / 均码";
    return `「${effName}」· 将生成 ${skuCount} 个规格（${specText}）`;
  }, [skuCount, effColors, effSizes, effName, colors.length, sizes.length]);

  async function submit() {
    setError(null);
    const cost = costPrice.trim() === "" ? 0 : toCents(costPrice);
    const sale = toCents(salePrice);
    const stock = initialStock.trim() === "" ? 0 : Number(initialStock);

    if (Number.isNaN(sale)) return setError("请填写有效的售价");
    if (Number.isNaN(cost) || cost < 0) return setError("进价格式有误");
    if (!Number.isInteger(stock) || stock < 0) return setError("库存需为非负整数");

    const skus = expandSkuMatrix({
      colors: effColors,
      sizes: effSizes,
      costPrice: cost,
      salePrice: sale,
      initialStock: stock,
    });

    const payload = {
      name: effName,
      coverImage: coverPath,
      skus,
    };
    const parsed = CreateProductInput.safeParse(payload);
    if (!parsed.success) {
      return setError(parsed.error.issues[0]?.message ?? "参数有误");
    }

    setSubmitting(true);
    try {
      const product = await createProduct(parsed.data);
      Alert.alert("建档成功", `已创建「${product.name}」，生成 ${product.skus.length} 个 SKU`, [
        {
          text: "好",
          onPress: () =>
            // 回到商品列表（无论从首页还是商品列表进入建档，都落在商品列表）
            navigation.reset({
              index: 1,
              routes: [{ name: "Home" }, { name: "Products" }],
            }),
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.topbarBtn}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>商品建档</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 顶部大照片区（Vestiaire §2.5）：建档视觉焦点，点击区≥48dp */}
      <View style={styles.photoBox}>
        {uploading ? (
          <ActivityIndicator size="large" color={themeColors.primary} />
        ) : coverPath ? (
          <Image source={{ uri: imageUrl(coverPath) }} style={styles.photo} />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.photoIcon}>📷</Text>
            <Text style={styles.photoHint}>添加封面图</Text>
          </View>
        )}
      </View>
      <View style={styles.photoBtns}>
        <Pressable
          style={({ pressed }) => [styles.photoBtn, pressed && styles.photoBtnPressed]}
          onPress={() => pickImage(true)}
        >
          <Text style={styles.photoBtnText}>📷 拍照</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.photoBtn, pressed && styles.photoBtnPressed]}
          onPress={() => pickImage(false)}
        >
          <Text style={styles.photoBtnText}>🖼️ 从相册选</Text>
        </Pressable>
      </View>

      {/* 价格 / 库存（必填，垂直字段） */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>进价（元）</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={themeColors.textMuted}
          value={costPrice}
          onChangeText={setCostPrice}
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>
          售价（元）<Text style={styles.required}> *</Text>
        </Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={themeColors.textMuted}
          value={salePrice}
          onChangeText={setSalePrice}
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>库存</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          placeholder="1"
          placeholderTextColor={themeColors.textMuted}
          value={initialStock}
          onChangeText={setInitialStock}
        />
      </View>

      {/* 详细设置（品名 / 颜色 / 尺码）：默认折叠 */}
      <Pressable
        style={({ pressed }) => [
          styles.detailToggle,
          detailExpanded && styles.detailToggleActive,
          pressed && styles.detailTogglePressed,
        ]}
        onPress={() => setDetailExpanded((v) => !v)}
      >
        <View style={styles.detailToggleLeft}>
          <Text style={styles.detailToggleText}>详细设置</Text>
          <Text style={styles.detailToggleSub}>品名 / 颜色 / 尺码（选填）</Text>
        </View>
        <View style={styles.detailToggleRight}>
          <Text style={styles.detailToggleAction}>{detailExpanded ? "收起" : "展开"}</Text>
          <Text style={styles.detailToggleAction}>{detailExpanded ? "▴" : "▾"}</Text>
        </View>
      </Pressable>

      {detailExpanded ? (
        <View style={styles.detailBody}>
          {/* 品名 */}
          <Text style={styles.label}>品名</Text>
          <TextInput
            style={styles.input}
            placeholder="留空将按材质+品类或「未命名商品」自动命名"
            placeholderTextColor={themeColors.textMuted}
            value={name}
            onChangeText={setName}
          />

          {/* 快速命名：材质 + 品类，自动组合写入品名 */}
          <Text style={styles.quickHint}>
            快速命名：选「材质」+「品类」自动组合（上方品名仍可手动编辑）
          </Text>

          {/* 材质 */}
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerColTitle}>材质</Text>
            {PRESET_MATERIALS.length > HOT_MATERIAL_COUNT ? (
              <Pressable onPress={() => setMaterialsExpanded((v) => !v)} hitSlop={8}>
                <Text style={styles.expandLink}>{materialsExpanded ? "收起 ▴" : "展开更多 ▾"}</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.chips}>
            {(() => {
              const all = [...PRESET_MATERIALS, ...extraMaterials];
              if (materialsExpanded) return all;
              const base = [...PRESET_MATERIALS.slice(0, HOT_MATERIAL_COUNT), ...extraMaterials];
              if (material && !base.includes(material)) base.push(material);
              return base;
            })().map((m) => (
              <Chip key={m} label={m} active={material === m} onPress={() => selectMaterial(m)} />
            ))}
          </View>
          <View style={styles.addRow}>
            <TextInput
              style={[styles.input, styles.flex1, styles.miniInput]}
              placeholder="自定义材质"
              placeholderTextColor={themeColors.textMuted}
              value={customMaterial}
              onChangeText={setCustomMaterial}
              onSubmitEditing={addCustomMaterial}
            />
            <Pressable
              style={({ pressed }) => [styles.miniAddBtn, pressed && styles.miniAddPressed]}
              onPress={addCustomMaterial}
            >
              <Text style={styles.addBtnText}>+</Text>
            </Pressable>
          </View>

          {/* 品类 */}
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerColTitle}>品类</Text>
            {PRESET_CATEGORIES.length > HOT_CATEGORY_COUNT ? (
              <Pressable onPress={() => setCategoriesExpanded((v) => !v)} hitSlop={8}>
                <Text style={styles.expandLink}>
                  {categoriesExpanded ? "收起 ▴" : "展开更多 ▾"}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.chips}>
            {(() => {
              const all = [...PRESET_CATEGORIES, ...extraCategories];
              if (categoriesExpanded) return all;
              const base = [...PRESET_CATEGORIES.slice(0, HOT_CATEGORY_COUNT), ...extraCategories];
              if (category && !base.includes(category)) base.push(category);
              return base;
            })().map((c) => (
              <Chip key={c} label={c} active={category === c} onPress={() => selectCategory(c)} />
            ))}
          </View>
          <View style={styles.addRow}>
            <TextInput
              style={[styles.input, styles.flex1, styles.miniInput]}
              placeholder="自定义品类"
              placeholderTextColor={themeColors.textMuted}
              value={customCategory}
              onChangeText={setCustomCategory}
              onSubmitEditing={addCustomCategory}
            />
            <Pressable
              style={({ pressed }) => [styles.miniAddBtn, pressed && styles.miniAddPressed]}
              onPress={addCustomCategory}
            >
              <Text style={styles.addBtnText}>+</Text>
            </Pressable>
          </View>

          {/* 颜色 */}
          <Text style={styles.label}>颜色（可多选）</Text>
          <View style={styles.chips}>
            {[...new Set([...PRESET_COLORS, ...colors])].map((c) => (
              <Chip
                key={c}
                label={c}
                active={colors.includes(c)}
                onPress={() => toggle(colors, setColors, c)}
              />
            ))}
          </View>
          <View style={styles.addRow}>
            <TextInput
              style={[styles.input, styles.flex1]}
              placeholder="自定义颜色"
              placeholderTextColor={themeColors.textMuted}
              value={customColor}
              onChangeText={setCustomColor}
              onSubmitEditing={() =>
                addCustom(customColor, colors, setColors, () => setCustomColor(""))
              }
            />
            <Pressable
              style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
              onPress={() => addCustom(customColor, colors, setColors, () => setCustomColor(""))}
            >
              <Text style={styles.addBtnText}>添加</Text>
            </Pressable>
          </View>

          {/* 尺码 */}
          <Text style={styles.label}>尺码（可多选）</Text>
          <View style={styles.chips}>
            {[...new Set([...PRESET_SIZES, ...sizes])].map((s) => (
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
              style={[styles.input, styles.flex1]}
              placeholder="自定义尺码"
              placeholderTextColor={themeColors.textMuted}
              value={customSize}
              onChangeText={setCustomSize}
              onSubmitEditing={() =>
                addCustom(customSize, sizes, setSizes, () => setCustomSize(""))
              }
            />
            <Pressable
              style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
              onPress={() => addCustom(customSize, sizes, setSizes, () => setCustomSize(""))}
            >
              <Text style={styles.addBtnText}>添加</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Text style={styles.preview}>{preview}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={({ pressed }) => [
          styles.submit,
          (submitting || salePrice.trim() === "") && styles.disabled,
          pressed && !(submitting || salePrice.trim() === "") && styles.submitPressed,
        ]}
        disabled={submitting || salePrice.trim() === ""}
        onPress={submit}
      >
        <Text style={styles.submitText}>保存建档</Text>
      </Pressable>
    </ScrollView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.chipPressed,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {active ? "✓ " : ""}
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  content: { padding: space.lg, paddingBottom: space.xxl * 2, gap: space.sm },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.sm,
  },
  topbarBtn: { minHeight: touch.minSize, justifyContent: "center" },
  back: { color: themeColors.primary, fontSize: font.body, width: 40 },
  title: { fontSize: font.title + 2, fontWeight: "800", color: themeColors.text },

  // 顶部大照片区（Vestiaire §2.5）
  photoBox: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radius.lg,
    backgroundColor: themeColors.card,
    borderWidth: 1.5,
    borderColor: themeColors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: space.sm,
  },
  photo: { width: "100%", height: "100%" },
  photoPlaceholder: { alignItems: "center", justifyContent: "center", gap: space.sm },
  photoIcon: { fontSize: 48 },
  photoHint: { color: themeColors.textMuted, fontSize: font.body },
  photoBtns: { flexDirection: "row", gap: space.md, marginBottom: space.md },
  photoBtn: {
    flex: 1,
    minHeight: touch.buttonHeight,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: themeColors.primary,
    backgroundColor: themeColors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  photoBtnPressed: { opacity: 0.7 },
  photoBtnText: { color: themeColors.primary, fontWeight: "800", fontSize: font.body },

  // 垂直字段（Vestiaire §2.5）
  fieldGroup: { gap: space.xs, marginBottom: space.xs },
  label: { fontSize: font.body, color: themeColors.text, fontWeight: "700" },
  required: { color: themeColors.danger },
  input: {
    borderWidth: 1.5,
    borderColor: themeColors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: touch.buttonHeight,
    fontSize: font.body,
    color: themeColors.text,
    backgroundColor: themeColors.card,
  },
  quickHint: {
    fontSize: font.caption,
    color: themeColors.textMuted,
    marginTop: space.sm,
    lineHeight: 20,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.md,
  },
  pickerColTitle: { fontSize: font.body, fontWeight: "700", color: themeColors.text },
  expandLink: { fontSize: font.caption, color: themeColors.primary, fontWeight: "700" },
  detailToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    backgroundColor: themeColors.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: themeColors.border,
    minHeight: touch.minSize + 8,
  },
  detailToggleActive: {
    backgroundColor: themeColors.primarySoft,
    borderColor: themeColors.primary,
  },
  detailTogglePressed: { opacity: 0.85 },
  detailToggleLeft: { flex: 1, paddingRight: space.md },
  detailToggleText: { fontSize: font.body, fontWeight: "700", color: themeColors.text },
  detailToggleSub: { fontSize: font.caption, color: themeColors.textMuted, marginTop: 2 },
  detailToggleRight: { flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 },
  detailToggleAction: { fontSize: font.body, color: themeColors.primary, fontWeight: "700" },
  detailBody: {
    marginTop: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    paddingTop: space.xs,
    backgroundColor: themeColors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: themeColors.border,
    gap: space.xs,
  },
  miniInput: { minHeight: touch.minSize + 4, paddingVertical: space.xs },
  miniAddBtn: {
    backgroundColor: themeColors.primarySoft,
    borderRadius: radius.md,
    width: touch.buttonHeight,
    minHeight: touch.buttonHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  miniAddPressed: { opacity: 0.7 },

  // chips（§2.5 大点击区、选中态高对比 + 勾）
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  chip: {
    paddingHorizontal: space.md,
    minHeight: touch.minSize,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: themeColors.border,
    backgroundColor: themeColors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: themeColors.primary, borderColor: themeColors.primary },
  chipPressed: { opacity: 0.85 },
  chipText: { color: themeColors.text, fontSize: font.body },
  chipTextActive: { color: "#fff", fontWeight: "800" },

  addRow: { flexDirection: "row", gap: space.sm, alignItems: "center", marginTop: space.xs },
  addBtn: {
    backgroundColor: themeColors.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    justifyContent: "center",
    minHeight: touch.buttonHeight,
  },
  addBtnPressed: { opacity: 0.7 },
  addBtnText: { color: themeColors.primary, fontWeight: "800", fontSize: font.body },
  flex1: { flex: 1 },
  preview: {
    marginTop: space.lg,
    fontSize: font.body,
    color: themeColors.primary,
    fontWeight: "700",
  },
  error: { color: themeColors.danger, marginTop: space.sm, fontSize: font.body },
  submit: {
    backgroundColor: themeColors.primary,
    minHeight: touch.buttonHeight + 4,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.lg,
  },
  submitPressed: { backgroundColor: themeColors.primaryPressed },
  disabled: { opacity: 0.5 },
  submitText: { color: "#fff", fontSize: font.body, fontWeight: "800" },
});
