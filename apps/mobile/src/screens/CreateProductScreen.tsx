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
import * as ImagePicker from "expo-image-picker";
import { expandSkuMatrix, CreateProductInput } from "@cloth-scan/shared";
import { createProduct, imageUrl, uploadImage } from "../api";

const PRESET_COLORS = ["黑", "白", "灰", "红", "蓝", "绿", "黄", "粉", "卡其"];
const PRESET_SIZES = ["S", "M", "L", "XL", "XXL", "均码"];

/**
 * 材质（单选）。女装热门排在最前（默认两行展示），其余折叠。
 */
const PRESET_MATERIALS = [
  // —— 热门（默认显示）——
  "纯棉", "雪纺", "牛仔", "针织", "真丝", "羊毛", "蕾丝", "莫代尔", "棉麻", "羊绒",
  // —— 折叠 ——
  "亚麻", "苎麻", "涤纶", "锦纶", "氨纶", "天丝", "粘纤", "桑蚕丝", "羊羔毛", "马海毛",
  "灯芯绒", "皮革", "麂皮绒", "毛呢", "法兰绒", "珊瑚绒", "天鹅绒", "丝绒", "网纱", "醋酸",
  "冰丝", "太空棉", "罗纹", "混纺", "化纤", "羽绒",
];

/**
 * 服装品类（单选）。女装热门排在最前（默认两行展示），其余折叠。
 */
const PRESET_CATEGORIES = [
  // —— 热门（默认显示）——
  "连衣裙", "T恤", "衬衫", "卫衣", "半身裙", "阔腿裤", "牛仔裤", "针织衫", "毛衣", "外套",
  // —— 折叠 ——
  "短袖", "长袖", "Polo衫", "打底衫", "吊带", "背心", "马甲", "休闲裤", "西裤", "工装裤",
  "直筒裤", "小脚裤", "哈伦裤", "打底裤", "运动裤", "卫裤", "短裤", "五分裤", "七分裤", "九分裤",
  "背带裤", "风衣", "大衣", "西装", "棉服", "棉袄", "羽绒服", "皮衣", "套装", "连体裤",
  "睡衣套装", "内衣", "保暖内衣", "围巾",
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

export function CreateProductScreen({
  onDone,
}: {
  onDone: (created: boolean) => void;
}) {
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
  const effName =
    name.trim() || (material || category ? `${material}${category}` : "未命名商品");

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(
      list.includes(value) ? list.filter((x) => x !== value) : [...list, value],
    );
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
    const specText = hasSpec
      ? `${effColors.join("/")} × ${effSizes.join("/")}`
      : "默认 / 均码";
    return `「${effName}」· 将生成 ${skuCount} 个规格（${specText}）`;
  }, [skuCount, effColors, effSizes, effName, colors.length, sizes.length]);

  async function submit() {
    setError(null);
    const cost = costPrice.trim() === "" ? 0 : toCents(costPrice);
    const sale = toCents(salePrice);
    const stock = initialStock.trim() === "" ? 0 : Number(initialStock);

    if (Number.isNaN(sale)) return setError("请填写有效的售价");
    if (Number.isNaN(cost) || cost < 0) return setError("进价格式有误");
    if (!Number.isInteger(stock) || stock < 0)
      return setError("库存需为非负整数");

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
      Alert.alert(
        "建档成功",
        `已创建「${product.name}」，生成 ${product.skus.length} 个 SKU`,
        [{ text: "好", onPress: () => onDone(true) }],
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topbar}>
        <Pressable onPress={() => onDone(false)}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>商品建档</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 封面图 */}
      <Text style={styles.label}>封面图</Text>
      <View style={styles.imageRow}>
        <View style={styles.imageBox}>
          {uploading ? (
            <ActivityIndicator />
          ) : coverPath ? (
            <Image
              source={{ uri: imageUrl(coverPath) }}
              style={styles.image}
            />
          ) : (
            <Text style={styles.imagePlaceholder}>无图</Text>
          )}
        </View>
        <View style={styles.imageBtns}>
          <Pressable style={styles.smallBtn} onPress={() => pickImage(true)}>
            <Text style={styles.smallBtnText}>拍照</Text>
          </Pressable>
          <Pressable style={styles.smallBtn} onPress={() => pickImage(false)}>
            <Text style={styles.smallBtnText}>从相册选</Text>
          </Pressable>
        </View>
      </View>

      {/* 价格 / 库存（必填，普通服装填这三项即可建档） */}
      <View style={styles.row}>
        <View style={styles.flex1}>
          <Text style={styles.label}>进价（元）</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            placeholder="0.00"
            value={costPrice}
            onChangeText={setCostPrice}
          />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.label}>售价（元）</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            placeholder="0.00"
            value={salePrice}
            onChangeText={setSalePrice}
          />
        </View>
      </View>
      <Text style={styles.label}>库存</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        placeholder="1"
        value={initialStock}
        onChangeText={setInitialStock}
      />

      {/* 详细设置（品名 / 颜色 / 尺码）：默认折叠 */}
      <Pressable
        style={[styles.detailToggle, detailExpanded && styles.detailToggleActive]}
        onPress={() => setDetailExpanded((v) => !v)}
      >
        <View style={styles.detailToggleLeft}>
          <Text style={styles.detailToggleText}>详细设置</Text>
          <Text style={styles.detailToggleSub}>品名 / 颜色 / 尺码（选填）</Text>
        </View>
        <View style={styles.detailToggleRight}>
          <Text style={styles.detailToggleAction}>
            {detailExpanded ? "收起" : "展开"}
          </Text>
          <Text style={styles.detailToggleAction}>
            {detailExpanded ? "▴" : "▾"}
          </Text>
        </View>
      </Pressable>

      {detailExpanded ? (
        <View style={styles.detailBody}>
      {/* 品名 */}
      <Text style={styles.label}>品名</Text>
      <TextInput
        style={styles.input}
        placeholder="留空将按材质+品类或「未命名商品」自动命名"
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
          <Pressable
            onPress={() => setMaterialsExpanded((v) => !v)}
            hitSlop={8}
          >
            <Text style={styles.expandLink}>
              {materialsExpanded ? "收起 ▴" : "展开更多 ▾"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.chips}>
        {(() => {
          const all = [...PRESET_MATERIALS, ...extraMaterials];
          if (materialsExpanded) return all;
          const base = [
            ...PRESET_MATERIALS.slice(0, HOT_MATERIAL_COUNT),
            ...extraMaterials,
          ];
          if (material && !base.includes(material)) base.push(material);
          return base;
        })().map((m) => (
          <Chip
            key={m}
            label={m}
            active={material === m}
            onPress={() => selectMaterial(m)}
          />
        ))}
      </View>
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, styles.flex1, styles.miniInput]}
          placeholder="自定义材质"
          value={customMaterial}
          onChangeText={setCustomMaterial}
          onSubmitEditing={addCustomMaterial}
        />
        <Pressable style={styles.miniAddBtn} onPress={addCustomMaterial}>
          <Text style={styles.addBtnText}>+</Text>
        </Pressable>
      </View>

      {/* 品类 */}
      <View style={styles.pickerHeader}>
        <Text style={styles.pickerColTitle}>品类</Text>
        {PRESET_CATEGORIES.length > HOT_CATEGORY_COUNT ? (
          <Pressable
            onPress={() => setCategoriesExpanded((v) => !v)}
            hitSlop={8}
          >
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
          const base = [
            ...PRESET_CATEGORIES.slice(0, HOT_CATEGORY_COUNT),
            ...extraCategories,
          ];
          if (category && !base.includes(category)) base.push(category);
          return base;
        })().map((c) => (
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
          style={[styles.input, styles.flex1, styles.miniInput]}
          placeholder="自定义品类"
          value={customCategory}
          onChangeText={setCustomCategory}
          onSubmitEditing={addCustomCategory}
        />
        <Pressable style={styles.miniAddBtn} onPress={addCustomCategory}>
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
          value={customColor}
          onChangeText={setCustomColor}
          onSubmitEditing={() =>
            addCustom(customColor, colors, setColors, () => setCustomColor(""))
          }
        />
        <Pressable
          style={styles.addBtn}
          onPress={() =>
            addCustom(customColor, colors, setColors, () => setCustomColor(""))
          }
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
          value={customSize}
          onChangeText={setCustomSize}
          onSubmitEditing={() =>
            addCustom(customSize, sizes, setSizes, () => setCustomSize(""))
          }
        />
        <Pressable
          style={styles.addBtn}
          onPress={() =>
            addCustom(customSize, sizes, setSizes, () => setCustomSize(""))
          }
        >
          <Text style={styles.addBtnText}>添加</Text>
        </Pressable>
      </View>
        </View>
      ) : null}

      <Text style={styles.preview}>{preview}</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[
          styles.submit,
          (submitting || salePrice.trim() === "") && styles.disabled,
        ]}
        disabled={submitting || salePrice.trim() === ""}
        onPress={submit}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>保存建档</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 48, gap: 6 },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  back: { color: "#2563eb", fontSize: 16, width: 40 },
  title: { fontSize: 20, fontWeight: "800", color: "#111" },
  label: { fontSize: 14, color: "#374151", marginTop: 12, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginTop: 4,
  },
  imageRow: { flexDirection: "row", gap: 12, alignItems: "center", marginTop: 4 },
  imageBox: {
    width: 88,
    height: 88,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "#f9fafb",
  },
  image: { width: "100%", height: "100%" },
  imagePlaceholder: { color: "#9ca3af" },
  imageBtns: { gap: 8 },
  smallBtn: {
    borderWidth: 1.5,
    borderColor: "#2563eb",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  smallBtnText: { color: "#2563eb", fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  quickHint: { fontSize: 12, color: "#9ca3af", marginTop: 8, lineHeight: 17 },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  pickerColTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#374151",
  },
  expandLink: { fontSize: 13, color: "#2563eb", fontWeight: "600" },
  detailToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  detailToggleActive: {
    backgroundColor: "#eff6ff",
    borderColor: "#bfdbfe",
  },
  detailToggleLeft: { flex: 1, paddingRight: 12 },
  detailToggleText: { fontSize: 15, fontWeight: "700", color: "#1f2937" },
  detailToggleSub: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  detailToggleRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  detailToggleAction: { fontSize: 14, color: "#2563eb", fontWeight: "700" },
  detailBody: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 2,
    backgroundColor: "#fcfdff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eef2f7",
    gap: 6,
  },
  miniInput: { paddingVertical: 7, fontSize: 14 },
  miniAddBtn: {
    backgroundColor: "#e5edff",
    borderRadius: 10,
    width: 42,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipText: { color: "#374151", fontSize: 15 },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  addRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  addBtn: {
    backgroundColor: "#e5edff",
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: "center",
    marginTop: 4,
    height: 42,
  },
  addBtnText: { color: "#2563eb", fontWeight: "700" },
  row: { flexDirection: "row", gap: 12 },
  flex1: { flex: 1 },
  preview: {
    marginTop: 16,
    fontSize: 14,
    color: "#2563eb",
    fontWeight: "600",
  },
  error: { color: "#dc2626", marginTop: 8 },
  submit: {
    backgroundColor: "#2563eb",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 16,
  },
  disabled: { opacity: 0.5 },
  submitText: { color: "#fff", fontSize: 18, fontWeight: "800" },
});
