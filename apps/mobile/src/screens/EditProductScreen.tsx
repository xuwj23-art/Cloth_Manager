import { useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { UpdateSkuInput } from "@cloth-scan/shared";
import { imageUrl, setProductArchived, updateProduct } from "../api";
import type { RootStackParamList } from "../navigation/RootNavigator";

type EditProductNav = NativeStackNavigationProp<RootStackParamList, "EditProduct">;
type EditProductRoute = RouteProp<RootStackParamList, "EditProduct">;

function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 元字符串 -> 分（非法返回 null） */
function yuanToCents(text: string): number | null {
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

interface SkuDraft {
  id: string;
  color: string;
  size: string;
  salePrice: string; // 元
  stock: string;
}

export function EditProductScreen() {
  const navigation = useNavigation<EditProductNav>();
  const route = useRoute<EditProductRoute>();
  const { product } = route.params;
  const [name, setName] = useState(product.name);
  const [skus, setSkus] = useState<SkuDraft[]>(
    product.skus.map((s) => ({
      id: s.id,
      color: s.color,
      size: s.size,
      salePrice: centsToYuan(s.salePrice),
      stock: String(s.stock),
    })),
  );
  const [saving, setSaving] = useState(false);
  const archived = !!product.archivedAt;

  function patchSku(id: string, patch: Partial<SkuDraft>) {
    setSkus((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function save() {
    if (!name.trim()) {
      Alert.alert("请填写商品名称");
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
    setSaving(true);
    try {
      await updateProduct(product.id, { name: name.trim(), skus: skuInputs });
      Alert.alert("已保存", "商品信息已更新");
      navigation.goBack();
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
              await setProductArchived(product.id, next);
              navigation.goBack();
            } catch (e) {
              Alert.alert("操作失败", (e as Error).message);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={styles.back}>取消</Text>
        </Pressable>
        <Text style={styles.title}>编辑商品</Text>
        <Pressable onPress={save} hitSlop={8} disabled={saving}>
          <Text style={[styles.saveLink, saving && styles.dim]}>{saving ? "保存中" : "保存"}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.headerRow}>
          <View style={styles.cover}>
            {product.coverImage ? (
              <Image source={{ uri: imageUrl(product.coverImage) }} style={styles.coverImg} />
            ) : (
              <Text style={styles.coverPlaceholder}>无图</Text>
            )}
          </View>
          <View style={styles.nameBox}>
            <Text style={styles.label}>商品名称</Text>
            <TextInput style={styles.nameInput} value={name} onChangeText={setName} />
            {archived ? <Text style={styles.archivedTag}>已售罄/已下架</Text> : null}
          </View>
        </View>

        <Text style={styles.sectionTitle}>规格 · 售价 · 库存</Text>
        {skus.map((s) => (
          <View key={s.id} style={styles.skuRow}>
            <Text style={styles.skuSpec}>
              {s.color}/{s.size}
            </Text>
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
          </View>
        ))}

        <Text style={styles.hint}>
          修改库存会自动记一笔「盘点调整」流水；总库存为 0 时商品将自动移入「已售罄」。
        </Text>

        <Pressable
          style={styles.printBtn}
          onPress={() => navigation.navigate("LabelPrint", { product })}
        >
          <Text style={styles.printText}>打印吊牌二维码</Text>
        </Pressable>

        <Pressable
          style={[styles.archiveBtn, archived ? styles.restore : styles.archive]}
          onPress={toggleArchive}
        >
          <Text
            style={[styles.archiveText, archived ? styles.restoreText : styles.archiveTextColor]}
          >
            {archived ? "恢复在售" : "下架商品"}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  back: { color: "#6b7280", fontSize: 16 },
  title: { fontSize: 18, fontWeight: "800", color: "#111" },
  saveLink: { color: "#2563eb", fontSize: 16, fontWeight: "700" },
  dim: { opacity: 0.5 },
  body: { padding: 16, gap: 14 },
  headerRow: { flexDirection: "row", gap: 14 },
  cover: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coverImg: { width: "100%", height: "100%" },
  coverPlaceholder: { color: "#9ca3af", fontSize: 12 },
  nameBox: { flex: 1, gap: 4 },
  label: { fontSize: 13, color: "#6b7280" },
  nameInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  archivedTag: { color: "#d97706", fontSize: 12, fontWeight: "700" },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#374151" },
  skuRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  skuSpec: { flex: 1, fontSize: 15, fontWeight: "600", color: "#111" },
  field: { width: 92, gap: 4 },
  fieldLabel: { fontSize: 11, color: "#9ca3af" },
  fieldInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    textAlign: "center",
  },
  hint: { fontSize: 12, color: "#9ca3af", lineHeight: 18 },
  archiveBtn: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1.5,
  },
  printBtn: {
    marginTop: 4,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#111827",
  },
  printText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  archive: { borderColor: "#fca5a5", backgroundColor: "#fef2f2" },
  restore: { borderColor: "#86efac", backgroundColor: "#f0fdf4" },
  archiveText: { fontSize: 16, fontWeight: "700" },
  archiveTextColor: { color: "#dc2626" },
  restoreText: { color: "#16a34a" },
});
