import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ProductScope, ProductWithSkus } from "@cloth-scan/shared";
import { deleteProduct, imageUrl, listProducts, thumbUrl } from "../api";
import { ImageViewer } from "../components/ImageViewer";

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export function ProductsScreen({
  onBack,
  onCreate,
  onEdit,
}: {
  onBack: () => void;
  onCreate: () => void;
  onEdit: (product: ProductWithSkus) => void;
}) {
  const [products, setProducts] = useState<ProductWithSkus[]>([]);
  const [scope, setScope] = useState<ProductScope>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await listProducts(scope));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = useCallback(
    (product: ProductWithSkus) => {
      Alert.alert(
        "删除商品",
        `确认删除「${product.name}」？\n删除后将从列表移除（图片与历史账单均保留）。已售出的历史记录不受影响。`,
        [
          { text: "取消", style: "cancel" },
          {
            text: "删除",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteProduct(product.id);
                await load();
              } catch (e) {
                Alert.alert("删除失败", (e as Error).message);
              }
            },
          },
        ],
      );
    },
    [load],
  );

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>商品列表</Text>
        <Pressable onPress={onCreate}>
          <Text style={styles.add}>+ 建档</Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, scope === "active" && styles.tabActive]}
          onPress={() => setScope("active")}
        >
          <Text style={[styles.tabText, scope === "active" && styles.tabTextActive]}>
            在售
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, scope === "archived" && styles.tabActive]}
          onPress={() => setScope("archived")}
        >
          <Text
            style={[styles.tabText, scope === "archived" && styles.tabTextActive]}
          >
            已售罄
          </Text>
        </Pressable>
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
      ) : (
        <FlatList
          data={products}
          keyExtractor={(p) => p.id}
          onRefresh={load}
          refreshing={loading}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {scope === "active"
                ? "还没有在售商品，点右上角「+ 建档」开始"
                : "没有已售罄的商品"}
            </Text>
          }
          renderItem={({ item }) => {
            const totalStock = item.skus.reduce((s, k) => s + k.stock, 0);
            const minPrice = Math.min(...item.skus.map((k) => k.salePrice));
            return (
              <Pressable style={styles.card} onPress={() => onEdit(item)}>
                <Pressable
                  style={styles.cover}
                  onPress={() => {
                    const u = imageUrl(item.coverImage);
                    if (u) setViewerUri(u);
                  }}
                >
                  {item.coverImage ? (
                    <Image
                      source={{ uri: thumbUrl(item.coverImage) }}
                      style={styles.coverImg}
                    />
                  ) : (
                    <Text style={styles.coverPlaceholder}>无图</Text>
                  )}
                </Pressable>
                <View style={styles.info}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.meta}>
                    {item.skus.length} 个 SKU · 库存 {totalStock}
                  </Text>
                  <Text style={styles.price}>{yuan(minPrice)} 起</Text>
                </View>
                {scope === "archived" ? (
                  <Pressable
                    style={styles.deleteBtn}
                    onPress={() => confirmDelete(item)}
                    hitSlop={8}
                  >
                    <Text style={styles.deleteText}>删除</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.editArrow}>编辑 ›</Text>
                )}
              </Pressable>
            );
          }}
        />
      )}

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
  title: { fontSize: 18, fontWeight: "800", color: "#111" },
  add: { color: "#2563eb", fontSize: 16, fontWeight: "700" },
  tabs: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tab: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  tabActive: { backgroundColor: "#2563eb" },
  tabText: { fontSize: 14, color: "#6b7280", fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  editArrow: { color: "#9ca3af", fontSize: 13, alignSelf: "center" },
  deleteBtn: {
    alignSelf: "center",
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  deleteText: { color: "#dc2626", fontSize: 13, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  list: { padding: 12, gap: 10 },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 48 },
  card: {
    flexDirection: "row",
    gap: 12,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  cover: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coverImg: { width: "100%", height: "100%" },
  coverPlaceholder: { color: "#9ca3af", fontSize: 12 },
  info: { flex: 1, justifyContent: "center", gap: 2 },
  name: { fontSize: 16, fontWeight: "700", color: "#111" },
  meta: { fontSize: 13, color: "#6b7280" },
  price: { fontSize: 15, color: "#e11d48", fontWeight: "700" },
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
