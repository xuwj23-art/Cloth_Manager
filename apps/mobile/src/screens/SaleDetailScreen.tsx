import { useCallback, useEffect, useState } from "react";
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
import type { SaleOrderDetail } from "@cloth-scan/shared";
import { deleteSaleOrder, editSaleOrder, getSale, imageUrl, thumbUrl } from "../api";
import { ImageViewer } from "../components/ImageViewer";
import { StateView } from "../components/StateView";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space, touch } from "../theme/tokens";
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
          style={styles.topbarBtn}
        >
          <Text style={styles.back}>{editing ? "取消" : "返回"}</Text>
        </Pressable>
        <Text style={styles.title}>{editing ? "编辑账单" : "单据详情"}</Text>
        {order && !editing ? (
          <Pressable onPress={startEdit} hitSlop={8} style={styles.topbarBtn}>
            <Text style={styles.editLink}>编辑</Text>
          </Pressable>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>

      <StateView loading={loading} error={error} onRetry={load}>
        {order ? (
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
                          <Image
                            source={{ uri: thumbUrl(it.coverImage) }}
                            style={styles.coverImg}
                          />
                        ) : (
                          <Text style={styles.coverPlaceholder}>👗</Text>
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
                          <Text
                            style={[styles.itemName, removed && styles.struck]}
                            numberOfLines={1}
                          >
                            {l.productName}
                          </Text>
                          <Text style={styles.itemSpec}>
                            {l.color}/{l.size}
                          </Text>
                          {removed ? (
                            <Pressable onPress={() => setQty(l.id, 1)} hitSlop={8}>
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
                <Pressable
                  style={({ pressed }) => [styles.deleteOrderBtn, pressed && styles.deletePressed]}
                  onPress={confirmDeleteOrder}
                >
                  <Text style={styles.deleteOrderText}>删除整单</Text>
                </Pressable>
              ) : null}
            </ScrollView>

            {editing ? (
              <View style={styles.editFooter}>
                <Pressable
                  style={({ pressed }) => [styles.cancelBtn, pressed && styles.cancelPressed]}
                  onPress={() => setEditing(false)}
                >
                  <Text style={styles.cancelText}>取消</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.saveBtn,
                    (saving || keptCount === 0) && styles.disabled,
                    pressed && !saving && keptCount > 0 && styles.savePressed,
                  ]}
                  disabled={saving || keptCount === 0}
                  onPress={save}
                >
                  <Text style={styles.saveText}>保存（{yuan(draftTotal)}）</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : null}
      </StateView>

      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topbarBtn: { minHeight: touch.minSize, justifyContent: "center" },
  back: { color: colors.primary, fontSize: font.body },
  editLink: { color: colors.primary, fontSize: font.body, fontWeight: "700" },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  placeholder: { width: 32 },
  body: { padding: space.lg, gap: space.md },
  // 总金额大数字卡（Monzo §2.2）
  summaryBox: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  amount: { fontSize: font.display, fontWeight: "800", color: colors.primary },
  metaLine: { fontSize: font.caption, color: colors.textMuted, marginTop: space.xs },
  sectionTitle: {
    fontSize: font.body,
    fontWeight: "700",
    color: colors.text,
    marginTop: space.sm,
  },
  itemRow: {
    flexDirection: "row",
    gap: space.md,
    alignItems: "center",
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemRemoved: { backgroundColor: colors.bg, borderColor: colors.border, opacity: 0.7 },
  cover: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coverImg: { width: "100%", height: "100%" },
  coverPlaceholder: { fontSize: 22 },
  itemInfo: { flex: 1, gap: 2 },
  itemName: { fontSize: font.body, fontWeight: "700", color: colors.text },
  itemSpec: { fontSize: font.caption, color: colors.textMuted },
  itemCalc: { fontSize: font.caption, color: colors.textMuted },
  itemSubtotal: { fontSize: font.body, fontWeight: "800", color: colors.text },
  editInfo: { flex: 1, gap: space.xs },
  struck: { textDecorationLine: "line-through", color: colors.textMuted },
  restoreText: { color: colors.primary, fontSize: font.caption, fontWeight: "700" },
  priceRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  priceYuan: { fontSize: font.body, fontWeight: "700", color: colors.text },
  priceInput: {
    minWidth: 80,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.primary,
    fontSize: font.body,
    fontWeight: "700",
    color: colors.text,
    paddingVertical: 2,
  },
  editControls: { alignItems: "flex-end", gap: space.xs },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.xs },
  stepBtn: {
    width: touch.minSize,
    height: touch.minSize,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: font.title, color: colors.primary, fontWeight: "800" },
  qty: { minWidth: 28, textAlign: "center", fontSize: font.body, fontWeight: "700" },
  lineDelete: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    minHeight: touch.minSize,
    justifyContent: "center",
  },
  lineDeleteText: { color: colors.danger, fontSize: font.caption, fontWeight: "700" },
  deleteOrderBtn: {
    marginTop: space.lg,
    borderWidth: 1.5,
    borderColor: "#FECACA",
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    paddingVertical: space.md,
    minHeight: touch.minSize,
    alignItems: "center",
    justifyContent: "center",
  },
  deletePressed: { opacity: 0.7 },
  deleteOrderText: { color: colors.danger, fontSize: font.body, fontWeight: "800" },
  editFooter: {
    flexDirection: "row",
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelBtn: {
    flex: 1,
    minHeight: touch.buttonHeight,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelPressed: { opacity: 0.7 },
  cancelText: { fontSize: font.body, fontWeight: "700", color: colors.textMuted },
  saveBtn: {
    flex: 2,
    backgroundColor: colors.primary,
    minHeight: touch.buttonHeight,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  savePressed: { backgroundColor: colors.primaryPressed },
  disabled: { opacity: 0.5 },
  saveText: { color: "#fff", fontSize: font.body, fontWeight: "800" },
});
