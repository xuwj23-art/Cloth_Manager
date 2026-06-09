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

  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [customColor, setCustomColor] = useState("");
  const [customSize, setCustomSize] = useState("");

  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [initialStock, setInitialStock] = useState("0");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skuCount = colors.length * sizes.length;

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
    if (skuCount === 0) return "请选择颜色和尺码";
    return `将生成 ${skuCount} 个 SKU（${colors.join("/")} × ${sizes.join("/")}）`;
  }, [skuCount, colors, sizes]);

  async function submit() {
    setError(null);
    const cost = toCents(costPrice);
    const sale = toCents(salePrice);
    const stock = Number(initialStock);

    if (!name.trim()) return setError("请填写品名");
    if (colors.length === 0 || sizes.length === 0)
      return setError("请至少选择一个颜色和一个尺码");
    if (Number.isNaN(cost) || Number.isNaN(sale)) return setError("请填写有效价格");
    if (!Number.isInteger(stock) || stock < 0)
      return setError("初始库存需为非负整数");

    const skus = expandSkuMatrix({
      colors,
      sizes,
      costPrice: cost,
      salePrice: sale,
      initialStock: stock,
    });

    const payload = {
      name: name.trim(),
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

      {/* 品名 */}
      <Text style={styles.label}>品名</Text>
      <TextInput
        style={styles.input}
        placeholder="如：纯棉圆领T恤"
        value={name}
        onChangeText={setName}
      />

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

      {/* 价格库存 */}
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
      <Text style={styles.label}>每个 SKU 初始库存</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={initialStock}
        onChangeText={setInitialStock}
      />

      <Text style={styles.preview}>{preview}</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.submit, (submitting || skuCount === 0) && styles.disabled]}
        disabled={submitting || skuCount === 0}
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
