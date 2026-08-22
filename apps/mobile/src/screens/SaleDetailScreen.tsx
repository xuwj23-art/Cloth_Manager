import { useCallback, useEffect, useState } from "react";
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
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { SaleOrderDetail } from "@cloth-scan/shared";
import { deleteSaleOrder, editSaleOrder, getSale, imageUrl, thumbUrl } from "../api";
import { ImageViewer } from "../components/ImageViewer";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { formatTime, yuan } from "../utils/format";

type SaleDetailNav = NativeStackNavigationProp<RootStackParamList, "SaleDetail">;
type SaleDetailRoute = RouteProp<RootStackParamList, "SaleDetail">;

/** 编辑草稿行：priceStr 为元字符串，便于输入 */
interface DraftLine {
  id: string;
  productName: string;
  color: string;
  size: string;
  barcode: string;
  coverImage: string | null;
  quantity: number;
  priceStr: string;
}

export function SaleDetailScreen() {
  const navigation = useNavigation<SaleDetailNav>();
  const route = useRoute<SaleDetailRoute>();
  const { orderId } = route.params;
  const [order, setOrder] = useState<SaleOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrder(await getSale(orderId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit() {
    if (!order) return;
    setDraft(
      order.items.map((it) => ({
        id: it.id,
        productName: it.productName,
        color: it.color,
        size: it.size,
        barcode: it.barcode,
        coverImage: it.coverImage,
        quantity: it.quantity,
        priceStr: (it.price / 100).toFixed(2),
      })),
    );
    setEditing(true);
  }

  function setQty(id: string, q: number) {
    setDraft((prev) => prev.map((l) => (l.id === id ? { ...l, quantity: Math.max(0, q) } : l)));
  }
  function setPrice(id: string, v: string) {
    setDraft((prev) => prev.map((l) => (l.id === id ? { ...l, priceStr: v } : l)));
  }

  const draftTotal = draft.reduce((s, l) => {
    const p = Math.round(Number(l.priceStr) * 100);
    return s + (Number.isFinite(p) && l.quantity > 0 ? p * l.quantity : 0);
  }, 0);
  const keptCount = draft.filter((l) => l.quantity > 0).length;

  async function save() {
    // 空串/纯空白的输入按无效处理（Number("")===0 会把清空误判为 ¥0 改价）
    if (draft.some((l) => l.quantity > 0 && l.priceStr.trim() === "")) {
      Alert.alert("价格有误", "请检查每件商品的成交价");
      return;
    }
    const items = draft.map((l) => ({
      id: l.id,
      quantity: l.quantity,
      price: Math.round(Number(l.priceStr) * 100),
    }));
    if (items.some((i) => !Number.isFinite(i.price) || i.price < 0)) {
      Alert.alert("价格有误", "请检查每件商品的成交价");
      return;
    }
    if (keptCount === 0) {
      Alert.alert("不能清空账单", "请保留至少一件商品，或使用「删除整单」");
      return;
    }
    setSaving(true);
    try {
      const updated = await editSaleOrder(orderId, items);
      setOrder(updated);
      setEditing(false);
      // 销售列表通过 useFocusEffect 在返回时自动刷新，无需显式回调
    } catch (e) {
      Alert.alert("保存失败", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function confirmDeleteOrder() {
    Alert.alert("删除整单", "确认删除这笔销售？已售出的库存会自动加回，此操作不可撤销。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSaleOrder(orderId);
            // 返回销售列表，focus 监听会自动刷新
            navigation.goBack();
          } catch (e) {
            Alert.alert("删除失败", (e as Error).message);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable
          onPress={editing ? () => setEditing(false) : () => navigation.goBack()}
          hitSlop={8}
        >
          <Text style={styles.back}>{editing ? "取消" : "返回"}</Text>
        </Pressable>
        <Text style={styles.title}>{editing ? "编辑账单" : "单据详情"}</Text>
        {order && !editing ? (
          <Pressable onPress={startEdit} hitSlop={8}>
            <Text style={styles.editLink}>编辑</Text>
          </Pressable>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={load}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : order ? (
        <>
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.summaryBox}>
              <Text style={styles.amount}>{yuan(editing ? draftTotal : order.totalAmount)}</Text>
              <Text style={styles.metaLine}>{formatTime(order.createdAt)}</Text>
              <Text style={styles.metaLine}>
                收银员：{order.operatorName ?? "—"} ·{" "}
                {editing ? `保留 ${keptCount} 项` : `共 ${order.itemCount} 件`}
              </Text>
            </View>

            <Text style={styles.sectionTitle}>商品明细</Text>

            {!editing
              ? order.items.map((it) => (
                  <View key={it.id} style={styles.itemRow}>
                    <Pressable
                      style={styles.cover}
                      onPress={() => {
                        const u = imageUrl(it.coverImage);
                        if (u) setViewerUri(u);
                      }}
                    >
                      {it.coverImage ? (
                        <Image source={{ uri: thumbUrl(it.coverImage) }} style={styles.coverImg} />
                      ) : (
                        <Text style={styles.coverPlaceholder}>无图</Text>
                      )}
                    </Pressable>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemName} numberOfLines={1}>
                        {it.productName}
                      </Text>
                      <Text style={styles.itemSpec}>
                        {it.color}/{it.size} · {it.barcode}
                      </Text>
                      <Text style={styles.itemCalc}>
                        {yuan(it.price)} × {it.quantity}
                      </Text>
                    </View>
                    <Text style={styles.itemSubtotal}>{yuan(it.subtotal)}</Text>
                  </View>
                ))
              : draft.map((l) => {
                  const removed = l.quantity === 0;
                  return (
                    <View key={l.id} style={[styles.itemRow, removed && styles.itemRemoved]}>
                      <View style={styles.editInfo}>
                        <Text style={[styles.itemName, removed && styles.struck]} numberOfLines={1}>
                          {l.productName}
                        </Text>
                        <Text style={styles.itemSpec}>
                          {l.color}/{l.size}
                        </Text>
                        {removed ? (
                          <Pressable onPress={() => setQty(l.id, 1)}>
                            <Text style={styles.restoreText}>已删除 · 点此撤销</Text>
                          </Pressable>
                        ) : (
                          <View style={styles.priceRow}>
                            <Text style={styles.priceYuan}>¥</Text>
                            <TextInput
                              style={styles.priceInput}
                              keyboardType="decimal-pad"
                              value={l.priceStr}
                              onChangeText={(v) => setPrice(l.id, v)}
                            />
                          </View>
                        )}
                      </View>
                      {!removed ? (
                        <View style={styles.editControls}>
                          <View style={styles.stepper}>
                            <Pressable
                              style={styles.stepBtn}
                              onPress={() => setQty(l.id, l.quantity - 1)}
                            >
                              <Text style={styles.stepText}>−</Text>
                            </Pressable>
                            <Text style={styles.qty}>{l.quantity}</Text>
                            <Pressable
                              style={styles.stepBtn}
                              onPress={() => setQty(l.id, l.quantity + 1)}
                            >
                              <Text style={styles.stepText}>＋</Text>
                            </Pressable>
                          </View>
                          <Pressable style={styles.lineDelete} onPress={() => setQty(l.id, 0)}>
                            <Text style={styles.lineDeleteText}>删除</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  );
                })}

            {!editing ? (
              <Pressable style={styles.deleteOrderBtn} onPress={confirmDeleteOrder}>
                <Text style={styles.deleteOrderText}>删除整单</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          {editing ? (
            <View style={styles.editFooter}>
              <Pressable style={styles.cancelBtn} onPress={() => setEditing(false)}>
                <Text style={styles.cancelText}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, saving && styles.disabled]}
                disabled={saving}
                onPress={save}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveText}>保存（{yuan(draftTotal)}）</Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}

      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
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
  back: { color: "#2563eb", fontSize: 16 },
  editLink: { color: "#2563eb", fontSize: 16, fontWeight: "700" },
  title: { fontSize: 18, fontWeight: "800", color: "#111" },
  placeholder: { width: 32 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  body: { padding: 16, gap: 10 },
  summaryBox: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  amount: { fontSize: 30, fontWeight: "800", color: "#e11d48" },
  metaLine: { fontSize: 14, color: "#6b7280", marginTop: 4 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#374151",
    marginTop: 8,
  },
  itemRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  itemRemoved: { backgroundColor: "#fafafa", borderColor: "#f0f0f0" },
  cover: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coverImg: { width: "100%", height: "100%" },
  coverPlaceholder: { color: "#9ca3af", fontSize: 11 },
  itemInfo: { flex: 1, gap: 2 },
  itemName: { fontSize: 15, fontWeight: "700", color: "#111" },
  itemSpec: { fontSize: 12, color: "#9ca3af" },
  itemCalc: { fontSize: 13, color: "#6b7280" },
  itemSubtotal: { fontSize: 16, fontWeight: "700", color: "#111" },
  editInfo: { flex: 1, gap: 4 },
  struck: { textDecorationLine: "line-through", color: "#9ca3af" },
  restoreText: { color: "#2563eb", fontSize: 13, fontWeight: "600" },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  priceYuan: { fontSize: 15, fontWeight: "700", color: "#111" },
  priceInput: {
    minWidth: 78,
    borderBottomWidth: 1.5,
    borderBottomColor: "#2563eb",
    fontSize: 16,
    fontWeight: "700",
    color: "#111",
    paddingVertical: 2,
  },
  editControls: { alignItems: "flex-end", gap: 6 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "#eef2ff",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 18, color: "#2563eb", fontWeight: "700" },
  qty: { minWidth: 26, textAlign: "center", fontSize: 16, fontWeight: "700" },
  lineDelete: { paddingHorizontal: 8, paddingVertical: 2 },
  lineDeleteText: { color: "#dc2626", fontSize: 12, fontWeight: "700" },
  deleteOrderBtn: {
    marginTop: 16,
    borderWidth: 1.5,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  deleteOrderText: { color: "#dc2626", fontSize: 16, fontWeight: "800" },
  editFooter: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    alignItems: "center",
  },
  cancelText: { fontSize: 16, fontWeight: "700", color: "#6b7280" },
  saveBtn: {
    flex: 2,
    backgroundColor: "#2563eb",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  disabled: { opacity: 0.5 },
  saveText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  error: { color: "#dc2626" },
  retry: {
    borderWidth: 1,
    borderColor: "#2563eb",
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  retryText: { color: "#2563eb" },
});
