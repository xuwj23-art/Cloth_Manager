import { memo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import Animated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { lineMemberPrice, memberPriceToTagPrice, type CartLine } from "@cloth-scan/shared";
import { thumbUrl } from "../../api";
import { colors, font, radius, space } from "../../theme/tokens";
import { useCashierStore } from "./store";
import { cashierStyles, yuan } from "./ui";
import { ImagePreviewModal } from "./ImagePreviewModal";

const staggerMs = 30; // motion.staggerMs

/**
 * 购物车列表（@shopify/flash-list，性能优于 FlatList）。
 * 每行：图 + 名 + 规格 + 价 + 数量步进器（-/+ 大按钮 ≥48dp）+ 删除。
 * 点击行（非步进器区域）打开改价 Sheet。
 * 列表项 stagger 淡入（30ms 错位，§3.4）。
 */
export function CartList() {
  const cart = useCashierStore((s) => s.cart);
  const setQty = useCashierStore((s) => s.setQty);
  const removeLine = useCashierStore((s) => s.removeLine);
  const startEditPrice = useCashierStore((s) => s.startEditPrice);
  const isMember = useCashierStore((s) => s.isMember);
  const [previewLine, setPreviewLine] = useState<CartLine | null>(null);

  if (cart.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIcon}>
          <Ionicons name="scan-outline" size={30} color={colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>扫码即上购物车</Text>
        <Text style={styles.emptySub}>支持连扫，同款自动累加数量</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlashList
        data={cart}
        keyExtractor={(item: CartLine) => item.skuId}
        renderItem={({ item, index }) => (
          <CartRow
            line={item}
            index={index}
            isMember={isMember}
            onInc={() => setQty(item.skuId, item.quantity + 1)}
            onDec={() => setQty(item.skuId, item.quantity - 1)}
            onRemove={() => removeLine(item.skuId)}
            onEdit={() => startEditPrice(item.skuId)}
            onPreview={item.image ? () => setPreviewLine(item) : undefined}
          />
        )}
      />
      <ImagePreviewModal
        line={previewLine}
        isMember={isMember}
        onClose={() => setPreviewLine(null)}
      />
    </View>
  );
}

interface CartRowProps {
  line: CartLine;
  index: number;
  isMember: boolean;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
  onEdit: () => void;
  /** 有图时点击缩略图打开预览；无图不传（占位字不可点） */
  onPreview?: () => void;
}

const CartRowBase = ({
  line,
  index,
  isMember,
  onInc,
  onDec,
  onRemove,
  onEdit,
  onPreview,
}: CartRowProps) => {
  const edited = line.origPrice != null && line.origPrice !== line.price;
  /** 原价（吊牌价）= 会员价 ÷ 0.8 取整到元；会员态划线展示 */
  const tagPrice = memberPriceToTagPrice(lineMemberPrice(line));
  const thumb = thumbUrl(line.image ?? null);
  return (
    <Animated.View entering={FadeIn.delay(index * staggerMs).duration(150)} style={styles.row}>
      {/* 左：商品缩略图（无图回退首字占位）+ 中部「名称/规格」两行居中 */}
      <View style={styles.mainZone}>
        {thumb ? (
          <Pressable
            style={styles.thumbBtn}
            onPress={onPreview}
            hitSlop={6}
            accessibilityRole="imagebutton"
            accessibilityLabel="查看商品图片"
          >
            <Image source={{ uri: thumb }} style={styles.thumbImg} resizeMode="cover" />
          </Pressable>
        ) : (
          <View style={styles.thumb}>
            <Text style={styles.thumbText}>{line.productName.slice(0, 1)}</Text>
          </View>
        )}
        <View style={styles.infoStack}>
          <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
            {line.productName}
          </Text>
          <Text style={styles.meta} numberOfLines={1} allowFontScaling={false}>
            {line.color}/{line.size}
          </Text>
        </View>
      </View>

      {/* 右：上行=价格两行（新价上/划线原价下，居中）+改价钮；下行=步进器+删除。
          价格竖排固定宽度，改价后不再横向扩张挤占中间商品名区。 */}
      <View style={styles.actionZone}>
        <View style={styles.priceEditRow}>
          <View style={styles.priceStack}>
            <Text
              style={[styles.priceText, isMember && styles.priceTextGold]}
              allowFontScaling={false}
            >
              {yuan(line.price)}
            </Text>
            {/* 会员态恒显划线原价（原价=会员价÷0.8）；非会员仅改价后显示进车基准价 */}
            {isMember || edited ? (
              <Text style={styles.origPrice} allowFontScaling={false}>
                {yuan(isMember ? tagPrice : line.origPrice!)}
              </Text>
            ) : null}
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.editBtn,
              edited && styles.editBtnOn,
              pressed && styles.editBtnPressed,
            ]}
            onPress={onEdit}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="改价"
          >
            <Ionicons
              name={edited ? "pricetag" : "pricetag-outline"}
              size={13}
              color={edited ? "#fff" : colors.primary}
            />
          </Pressable>
        </View>
        <View style={styles.stepper}>
          <Pressable
            style={[
              cashierStyles.stepperBtn,
              styles.stepSm,
              line.quantity <= 1 && cashierStyles.disabled,
            ]}
            disabled={line.quantity <= 1}
            onPress={onDec}
            hitSlop={7}
            accessibilityRole="button"
            accessibilityLabel="减少数量"
          >
            <Ionicons name="remove" size={15} color={colors.primary} />
          </Pressable>
          <Text style={styles.qty}>{line.quantity}</Text>
          <Pressable
            style={[cashierStyles.stepperBtn, styles.stepSm]}
            onPress={onInc}
            hitSlop={7}
            accessibilityRole="button"
            accessibilityLabel="增加数量"
          >
            <Ionicons name="add" size={15} color={colors.primary} />
          </Pressable>
          <Pressable
            style={styles.removeBtn}
            onPress={onRemove}
            hitSlop={7}
            accessibilityRole="button"
            accessibilityLabel="删除该行"
          >
            <Ionicons name="trash-outline" size={13} color={colors.danger} />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
};

const CartRow = memo(CartRowBase);

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.sm },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingBottom: 24 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#EEF2FA",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: "#6B7280" },
  emptySub: { fontSize: 12, color: "#9AA6B8" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
    marginBottom: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    gap: space.sm,
  },
  mainZone: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    flex: 1,
    maxWidth: 210,
    minWidth: 0,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: "#EEF2FA",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  thumbBtn: {
    width: 56,
    height: 56,
    borderRadius: 14,
    overflow: "hidden",
    flexShrink: 0,
    backgroundColor: "#EEF2FA",
  },
  thumbImg: { width: "100%", height: "100%" },
  thumbText: {
    fontSize: font.body + 2,
    fontWeight: "800",
    color: "#101E3C",
  },
  infoStack: {
    flex: 1,
    minWidth: 0,
    maxHeight: 56,
    justifyContent: "center",
    alignItems: "center",
    gap: 3,
  },
  name: { fontSize: 14, fontWeight: "600", color: colors.text, width: "100%", textAlign: "center" },
  meta: { fontSize: 11, color: colors.textMuted },
  actionZone: {
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "space-between",
    alignSelf: "stretch",
    gap: 6,
  },
  priceEditRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  /** 价格两行竖排：新价在上、划线原价在下，均左右居中；定宽防横向挤占名称区 */
  priceStack: { alignItems: "center", minWidth: 78 },
  priceText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#101E3C",
  },
  /** 会员态成交价金色 */
  priceTextGold: { color: colors.gold },
  origPrice: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
    textDecorationLine: "line-through",
    marginTop: 1,
  },
  editBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  editBtnPressed: { backgroundColor: "#DDE7FB" },
  editBtnOn: { backgroundColor: colors.danger },
  stepper: { flexDirection: "row", alignItems: "center", gap: 3 },
  stepSm: { width: 32, height: 32, borderRadius: 10 },
  qty: { minWidth: 18, textAlign: "center", fontSize: 14, fontWeight: "700" },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.dangerSoft,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
});
