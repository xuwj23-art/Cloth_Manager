import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, font, radius, space } from "../../theme/tokens";
import { imageUrl } from "../../api";

export type PhotoKey = "front" | "back" | "detail";

export const PHOTO_SLOT_DEFS: { key: PhotoKey; label: string }[] = [
  { key: "front", label: "正面" },
  { key: "back", label: "反面" },
  { key: "detail", label: "细节" },
];

export function PhotoSlots({
  photos,
  uploadingKey,
  onPressSlot,
  mode = "edit",
}: {
  photos: Record<PhotoKey, string | null>;
  uploadingKey: PhotoKey | null;
  onPressSlot: (key: PhotoKey) => void;
  mode?: "edit" | "view";
}) {
  const viewing = mode === "view";
  return (
    <View style={styles.row}>
      {PHOTO_SLOT_DEFS.map((s) => {
        const uri = photos[s.key];
        const uploading = uploadingKey === s.key;
        return (
          <Pressable
            key={s.key}
            style={styles.slot}
            onPress={() => {
              if (viewing && !uri) return;
              onPressSlot(s.key);
            }}
            accessibilityLabel={`${s.label}图`}
          >
            {uploading ? (
              <ActivityIndicator color={colors.primary} />
            ) : uri ? (
              <>
                <Image source={{ uri: imageUrl(uri) }} style={styles.img} />
                {!viewing ? (
                  <View style={styles.replaceBadge}>
                    <Text style={styles.replaceText}>更换</Text>
                  </View>
                ) : null}
              </>
            ) : (
              <View style={styles.emptyInner}>
                {viewing ? null : <Text style={styles.plus}>+</Text>}
                <Text style={styles.emptyHint}>{s.label}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm },
  slot: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  img: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  emptyInner: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 12,
  },
  plus: {
    fontSize: 28,
    color: colors.primary,
    fontWeight: "800",
    lineHeight: 32,
    includeFontPadding: false,
  },
  emptyHint: { fontSize: font.caption, color: colors.textMuted, textAlign: "center" },
  replaceBadge: {
    position: "absolute",
    right: 6,
    bottom: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  replaceText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
