import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { BackButton } from "../components/BackButton";
import { useDialog } from "../dialog-context";
import { abandonOp, listFailedOps, retryOp, type OutboxItem } from "../db/outbox";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { formatTime, yuan } from "../utils/format";

type SyncErrorsNav = NativeStackNavigationProp<RootStackParamList, "SyncErrors">;

/** 解析 sale payload 摘要：商品件数 + 实收金额。损坏 payload 返回 null。 */
function summarizeSalePayload(raw: string): { itemCount: number; total: number } | null {
  try {
    const p = JSON.parse(raw) as {
      items?: { skuId: string; quantity: number; price: number }[];
      orderDiscountCents?: number;
    };
    const items = p.items ?? [];
    const itemCount = items.reduce((s, it) => s + (it.quantity ?? 0), 0);
    const gross = items.reduce((s, it) => s + (it.price ?? 0) * (it.quantity ?? 0), 0);
    const total = Math.max(0, gross - (p.orderDiscountCents ?? 0));
    return { itemCount, total };
  } catch {
    return null;
  }
}

export function SyncErrorsScreen() {
  const navigation = useNavigation<SyncErrorsNav>();
  const { confirm } = useDialog();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listFailedOps());
    } finally {
      setLoading(false);
    }
  }, []);

  // 进入/返回本屏时刷新：重试/放弃后返回首页警告条也需要重新计算
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRetry = async (opId: string) => {
    await retryOp(opId);
    await load();
  };

  const confirmAbandon = async (op: OutboxItem) => {
    const ok = await confirm({
      title: "放弃同步",
      message: "确定放弃这笔销售？",
      confirmLabel: "放弃",
      destructive: true,
    });
    if (!ok) return;
    await abandonOp(op.opId);
    await load();
  };

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>同步失败</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {!loading && items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✓</Text>
            <Text style={styles.emptyText}>暂无同步失败的记录</Text>
          </View>
        ) : (
          items.map((op) => {
            const summary = summarizeSalePayload(op.payload);
            return (
              <View key={op.opId} style={styles.card}>
                <Text style={styles.errorMsg} numberOfLines={3}>
                  {op.error ?? "未知错误"}
                </Text>
                <Text style={styles.meta}>单号 {op.opId}</Text>
                <Text style={styles.meta}>失败时间 {formatTime(op.createdAt)}</Text>
                {summary ? (
                  <Text style={styles.meta}>
                    {summary.itemCount} 件 · 合计 {yuan(summary.total)}
                  </Text>
                ) : (
                  <Text style={styles.meta}>payload 解析失败</Text>
                )}

                <View style={styles.btnRow}>
                  <Pressable
                    style={[styles.btn, styles.retryBtn]}
                    onPress={() => void onRetry(op.opId)}
                  >
                    <Text style={styles.retryText}>重试</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btn, styles.abandonBtn]}
                    onPress={() => void confirmAbandon(op)}
                  >
                    <Text style={styles.abandonText}>放弃</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
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
  back: { color: "#2563eb", fontSize: 16 },
  title: { fontSize: 18, fontWeight: "800", color: "#111" },
  placeholder: { width: 32 },
  body: { padding: 16, gap: 12 },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 64,
  },
  emptyIcon: { fontSize: 40, color: "#16a34a", fontWeight: "800" },
  emptyText: { fontSize: 16, color: "#6b7280" },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    padding: 14,
    gap: 4,
  },
  errorMsg: { fontSize: 16, fontWeight: "700", color: "#b91c1c" },
  meta: { fontSize: 13, color: "#6b7280" },
  btnRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  retryBtn: {
    backgroundColor: "#2563eb",
  },
  retryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  abandonBtn: {
    borderWidth: 1.5,
    borderColor: "#dc2626",
    backgroundColor: "#fff",
  },
  abandonText: { color: "#dc2626", fontSize: 16, fontWeight: "700" },
});
