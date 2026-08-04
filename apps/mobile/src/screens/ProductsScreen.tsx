import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ProductScope, ProductWithSkus } from "@cloth-scan/shared";
import { deleteProduct, imageUrl, listProducts, thumbUrl } from "../api";
import { ImageViewer } from "../components/ImageViewer";
import { StateView } from "../components/StateView";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space, touch } from "../theme/tokens";
import { yuan } from "../utils/format";

type ProductsNav = NativeStackNavigationProp<RootStackParamList, "Products">;

export function ProductsScreen() {
  const navigation = useNavigation<ProductsNav>();
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
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.topbarBtn}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>商品列表</Text>
        <Pressable
          onPress={() => navigation.navigate("CreateProduct")}
          hitSlop={8}
          style={styles.topbarBtn}
        >
          <Text style={styles.add}>+ 建档</Text>
        </Pressable>
      </View>

      {/* 分段控件：在售 / 已售罄（§2.3 大段、不靠小图标） */}
      <View style={styles.tabs}>
        <Pressable
          style={({ pressed }) => [
            styles.tab,
            scope === "active" && styles.tabActive,
            pressed && scope === "active" && styles.tabActivePressed,
          ]}
          onPress={() => setScope("active")}
        >
          <Text style={[styles.tabText, scope === "active" && styles.tabTextActive]}>在售</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.tab,
            scope === "archived" && styles.tabActive,
            pressed && scope === "archived" && styles.tabActivePressed,
          ]}
          onPress={() => setScope("archived")}
        >
          <Text style={[styles.tabText, scope === "archived" && styles.tabTextActive]}>已售罄</Text>
        </Pressable>
      </View>

      <StateView
        loading={loading}
        error={error}
        onRetry={load}
        empty={!loading && !error && products.length === 0}
        emptyText={
          scope === "active" ? "还没有在售商品，点右上角「+ 建档」开始" : "没有已售罄的商品"
        }
        emptyActionText={scope === "active" ? "+ 建档" : undefined}
        onEmptyAction={scope === "active" ? () => navigation.navigate("CreateProduct") : undefined}
      >
        <FlatList
          data={products}
          keyExtractor={(p) => p.id}
          onRefresh={load}
          refreshing={loading}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const totalStock = item.skus.reduce((s, k) => s + k.stock, 0);
            const minPrice = Math.min(...item.skus.map((k) => k.salePrice));
            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => navigation.navigate("EditProduct", { product: item })}
              >
                <Pressable
                  style={styles.cover}
                  onPress={() => {
                    const u = imageUrl(item.coverImage);
                    if (u) setViewerUri(u);
                  }}
                >
                  {item.coverImage ? (
                    <Image source={{ uri: thumbUrl(item.coverImage) }} style={styles.coverImg} />
                  ) : (
                    <Text style={styles.coverPlaceholder}>👗</Text>
                  )}
                </Pressable>
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.meta}>
                    {item.skus.length} 个 SKU · 库存 {totalStock}
                  </Text>
                  <Text style={styles.price}>{yuan(minPrice)} 起</Text>
                  {scope === "archived" ? (
                    <Pressable
                      style={styles.deleteBtn}
                      onPress={() => confirmDelete(item)}
                      hitSlop={8}
                    >
                      <Text style={styles.deleteText}>删除</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.editHint}>点击编辑 ›</Text>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
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
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  add: { color: colors.primary, fontSize: font.body, fontWeight: "700" },

  // 分段控件（§2.3）
  tabs: {
    flexDirection: "row",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  tab: {
    flex: 1,
    paddingVertical: space.md - 2,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    minHeight: touch.minSize,
    justifyContent: "center",
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabActivePressed: { backgroundColor: colors.primaryPressed },
  tabText: { fontSize: font.body, color: colors.textMuted, fontWeight: "700" },
  tabTextActive: { color: "#fff" },

  list: { padding: space.md, gap: space.md },
  // 大封面卡（Etsy §2.3）：图为主、品名 + SKU 数 + 价格强调
  card: {
    flexDirection: "row",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  cardPressed: { opacity: 0.85 },
  cover: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coverImg: { width: "100%", height: "100%" },
  coverPlaceholder: { fontSize: 36 },
  info: { flex: 1, gap: space.xs, justifyContent: "center" },
  name: { fontSize: font.title, fontWeight: "700", color: colors.text },
  meta: { fontSize: font.caption, color: colors.textMuted },
  price: { fontSize: font.body + 2, color: colors.primary, fontWeight: "800" },
  editHint: { fontSize: font.caption, color: colors.textMuted, marginTop: space.xs },
  deleteBtn: {
    alignSelf: "flex-start",
    borderWidth: 1.5,
    borderColor: "#FECACA",
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    minHeight: touch.minSize,
    justifyContent: "center",
    marginTop: space.xs,
  },
  deleteText: { color: colors.danger, fontSize: font.caption, fontWeight: "700" },
});
