import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CartLine } from "@cloth-scan/shared";
import { imageUrl } from "../../api";
import { colors, radius, space } from "../../theme/tokens";
import { yuan } from "./ui";

/**
 * 购物车缩略图预览弹层（仅展示）：白色圆角长矩形居中，
 * 主体为商品正面图，底部一行名称 + 颜色/尺码 + 价格。
 * 点击遮罩或卡片任意处关闭。
 */
export function ImagePreviewModal({
  line,
  onClose,
}: {
  line: CartLine | null;
  onClose: () => void;
}) {
  if (!line) return null;
  const edited = line.origPrice != null && line.origPrice !== line.price;
  const uri = imageUrl(line.image ?? null);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={onClose} accessibilityLabel="关闭预览">
          <View style={styles.imageWrap}>
            {uri ? (
              <Image source={{ uri }} style={styles.image} resizeMode="contain" />
            ) : (
              <View style={[styles.image, styles.fallback]}>
                <Ionicons name="image-outline" size={48} color="#C6D0E2" />
              </View>
            )}
          </View>
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>
              {line.productName}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {line.color}/{line.size}
            </Text>
            <View style={styles.priceRow}>
              {edited ? (
                <Text style={styles.orig} numberOfLines={1} allowFontScaling={false}>
                  {yuan(line.origPrice!)}
                </Text>
              ) : null}
              <Text style={styles.price} numberOfLines={1} allowFontScaling={false}>
                {yuan(line.price)}
              </Text>
              <Text style={styles.unit} allowFontScaling={false}>
                / 件
              </Text>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(13,22,44,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "82%",
    maxHeight: "74%",
    borderRadius: radius.xl + 4,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  imageWrap: {
    width: "100%",
    aspectRatio: 3 / 4,
    backgroundColor: "#F6F8FC",
  },
  image: { width: "100%", height: "100%" },
  fallback: { alignItems: "center", justifyContent: "center" },
  info: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    alignItems: "center",
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#EDF0F6",
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.text, textAlign: "center" },
  meta: { fontSize: 12, color: colors.textMuted },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 2 },
  orig: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  price: { fontSize: 16, fontWeight: "800", color: "#101E3C" },
  unit: { fontSize: 11, color: colors.textMuted },
});
