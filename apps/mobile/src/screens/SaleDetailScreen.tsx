import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { SaleOrderDetail } from "@cloth-scan/shared";
import { getSale, imageUrl, thumbUrl } from "../api";
import { ImageViewer } from "../components/ImageViewer";

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

export function SaleDetailScreen({
  orderId,
  onBack,
}: {
  orderId: string;
  onBack: () => void;
}) {
  const [order, setOrder] = useState<SaleOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

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

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>单据详情</Text>
        <View style={styles.placeholder} />
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
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.summaryBox}>
            <Text style={styles.amount}>{yuan(order.totalAmount)}</Text>
            <Text style={styles.metaLine}>{formatTime(order.createdAt)}</Text>
            <Text style={styles.metaLine}>
              收银员：{order.operatorName ?? "—"} · 共 {order.itemCount} 件
            </Text>
          </View>

          <Text style={styles.sectionTitle}>商品明细</Text>
          {order.items.map((it) => (
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
          ))}
        </ScrollView>
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
