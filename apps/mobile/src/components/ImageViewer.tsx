import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";

/**
 * 全屏图片查看器：点击缩略图传入 uri 即可放大；点击任意处或「关闭」退出。
 * 受控组件：uri 为 null 时隐藏。
 */
export function ImageViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.mask} onPress={onClose}>
        {uri ? <Image source={{ uri }} style={styles.image} resizeMode="contain" /> : null}
        <View style={styles.closeBtn} pointerEvents="none">
          <Text style={styles.closeText}>关闭</Text>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: "100%", height: "80%" },
  closeBtn: { position: "absolute", bottom: 40 },
  closeText: { color: "rgba(255,255,255,0.7)", fontSize: 14 },
});
