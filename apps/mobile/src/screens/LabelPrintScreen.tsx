import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import QRCode from "react-native-qrcode-svg";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import {
  connectPrinterAuto,
  disconnectPrinter,
  getBondedDevices,
  isLocationEnabled,
  isPrinterAvailable,
  isPrinterConnected,
  printJob,
} from "../printer/ctPrinter";
import { buildCtPrintJob, totalLabelCount } from "../printer/labelLayout";
import type { CtBondedDevice } from "../../modules/ct-printer/src/CtPrinter.types";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space, touch } from "../theme/tokens";
import { yuan } from "../utils/format";

type LabelPrintNav = NativeStackNavigationProp<RootStackParamList, "LabelPrint">;
type LabelPrintRoute = RouteProp<RootStackParamList, "LabelPrint">;

/** 常见服装吊牌/不干胶尺寸（mm） */
const LABEL_SIZES = [
  { id: "60x40", label: "60×40", w: 60, h: 40 },
  { id: "40x30", label: "40×30", w: 40, h: 30 },
  { id: "50x30", label: "50×30", w: 50, h: 30 },
  { id: "40x60", label: "40×60", w: 40, h: 60 },
] as const;

const ORIENTATIONS = [
  { id: "portrait", label: "纵向" },
  { id: "landscape", label: "横向" },
] as const;

type Orientation = (typeof ORIENTATIONS)[number]["id"];

type LabelSize = (typeof LABEL_SIZES)[number];

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 把 QRCode 组件 ref 转成 base64 PNG（无 data: 前缀） */
function refToDataURL(
  ref: { toDataURL?: (cb: (d: string) => void) => void } | undefined,
): Promise<string> {
  return new Promise((resolve) => {
    if (!ref?.toDataURL) {
      resolve("");
      return;
    }
    ref.toDataURL((data: string) => resolve(data));
  });
}

interface LabelItem {
  qr: string;
  code: string;
  price: string;
}

function buildLabelsHtml(labels: LabelItem[], size: LabelSize, orientation: Orientation): string {
  const portrait = orientation === "portrait";
  // 纵向：物理标签仍是 size.w×size.h，但内容按 (h×w) 排版后旋转 90° 填入
  const innerW = portrait ? size.h : size.w;
  const innerH = portrait ? size.w : size.h;
  const cells = labels
    .map(
      (l) => `
    <div class="label" style="width:${size.w}mm;height:${size.h}mm;">
      <div class="inner" style="width:${innerW}mm;height:${innerH}mm;${
        portrait ? "transform:rotate(90deg);" : ""
      }">
        <img class="qr" src="data:image/png;base64,${l.qr}"/>
        <div class="code">${escapeHtml(l.code)}</div>
        <div class="price">${escapeHtml(l.price)}</div>
      </div>
    </div>`,
    )
    .join("");
  // 居中竖排：大二维码（主视觉）→ SKU 条码 → 价格
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    *{box-sizing:border-box;}
    body{margin:0;padding:4mm;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;}
    .label{border:1px dashed #bbb;margin:1mm;float:left;overflow:hidden;
      display:flex;align-items:center;justify-content:center;}
    .inner{display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:1.5mm;overflow:hidden;}
    .qr{height:64%;width:auto;aspect-ratio:1;}
    .code{font-size:7pt;letter-spacing:0.3px;color:#222;margin-top:1mm;
      max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .price{font-size:11pt;font-weight:800;margin-top:0.6mm;}
  </style></head><body>${cells}</body></html>`;
}

export function LabelPrintScreen() {
  const navigation = useNavigation<LabelPrintNav>();
  const route = useRoute<LabelPrintRoute>();
  const { product } = route.params;
  const [size, setSize] = useState<LabelSize>(LABEL_SIZES[0]);
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(product.skus.map((s) => [s.id, 1])),
  );
  const [busy, setBusy] = useState(false);
  const refs = useRef<Map<string, { toDataURL?: (cb: (d: string) => void) => void }>>(new Map());
  const [btOpen, setBtOpen] = useState(false);
  const [devices, setDevices] = useState<CtBondedDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connected, setConnected] = useState(isPrinterConnected());

  function setQtyFor(id: string, n: number) {
    setQty((prev) => ({ ...prev, [id]: Math.max(0, n) }));
  }

  function fillByStock() {
    setQty(Object.fromEntries(product.skus.map((s) => [s.id, Math.max(s.stock, 0)])));
  }

  async function collectLabels(): Promise<LabelItem[]> {
    const labels: LabelItem[] = [];
    for (const sku of product.skus) {
      const q = qty[sku.id] ?? 0;
      if (q <= 0) continue;
      const data = await refToDataURL(refs.current.get(sku.id));
      if (!data) continue;
      const item: LabelItem = {
        qr: data,
        code: sku.barcode,
        price: yuan(sku.salePrice),
      };
      for (let i = 0; i < q; i++) labels.push(item);
    }
    return labels;
  }

  async function handlePrint() {
    setBusy(true);
    try {
      const labels = await collectLabels();
      if (labels.length === 0) {
        Alert.alert("请至少选择 1 个规格的份数");
        return;
      }
      await Print.printAsync({ html: buildLabelsHtml(labels, size, orientation) });
    } catch (e) {
      Alert.alert("打印失败", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSharePdf() {
    setBusy(true);
    try {
      const labels = await collectLabels();
      if (labels.length === 0) {
        Alert.alert("请至少选择 1 个规格的份数");
        return;
      }
      const { uri } = await Print.printToFileAsync({
        html: buildLabelsHtml(labels, size, orientation),
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
      } else {
        Alert.alert("已生成 PDF", uri);
      }
    } catch (e) {
      Alert.alert("生成 PDF 失败", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openBluetooth() {
    setBtOpen(true);
    setScanning(true);
    try {
      const list = await getBondedDevices();
      setDevices(list);
    } catch (e) {
      Alert.alert("读取蓝牙设备失败", (e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function doConnect(dev: CtBondedDevice) {
    if (busy) return;
    setBusy(true);
    try {
      const { port } = await connectPrinterAuto(dev.mac);
      setConnected(true);
      setBtOpen(false);
      Alert.alert("已连接", `打印机：${dev.name}（${port}）`);
    } catch (e) {
      const msg = (e as Error).message;
      // 若是权限/位置类失败，且系统定位没开，给出更明确指引
      if (/权限|516|位置/.test(msg) && !isLocationEnabled()) {
        Alert.alert(
          "连接失败",
          `${msg}\n\n检测到手机「位置/GPS」未打开——经典蓝牙(SPP)连接需要它。请下拉通知栏打开「位置」后重试。`,
        );
      } else {
        Alert.alert("连接失败", msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleBtPrint() {
    if (!isPrinterConnected()) {
      await openBluetooth();
      return;
    }
    const job = buildCtPrintJob(product, qty, {
      size: { widthMm: size.w, heightMm: size.h },
      orientation,
    });
    if (job.labels.length === 0) {
      Alert.alert("请至少选择 1 个规格的份数");
      return;
    }
    setBusy(true);
    try {
      await printJob(job);
      Alert.alert("已发送打印", `共 ${totalLabelCount(job)} 张标签`);
    } catch (e) {
      Alert.alert("打印失败", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const totalLabels = product.skus.reduce((s, k) => s + (qty[k.id] ?? 0), 0);

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.topbarBtn}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>打印吊牌</Text>
        <Pressable onPress={fillByStock} hitSlop={8} style={styles.topbarBtn}>
          <Text style={styles.fillLink}>按库存</Text>
        </Pressable>
      </View>

      <View style={styles.sizeRow}>
        <Text style={styles.sizeLabel}>标签尺寸(mm)</Text>
        {LABEL_SIZES.map((s) => (
          <Pressable
            key={s.id}
            style={({ pressed }) => [
              styles.sizeChip,
              size.id === s.id && styles.sizeChipOn,
              pressed && size.id !== s.id && styles.chipPressed,
            ]}
            onPress={() => setSize(s)}
          >
            <Text style={[styles.sizeChipText, size.id === s.id && styles.sizeChipTextOn]}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.sizeRow}>
        <Text style={styles.sizeLabel}>打印方向</Text>
        {ORIENTATIONS.map((o) => (
          <Pressable
            key={o.id}
            style={({ pressed }) => [
              styles.sizeChip,
              orientation === o.id && styles.sizeChipOn,
              pressed && orientation !== o.id && styles.chipPressed,
            ]}
            onPress={() => setOrientation(o.id)}
          >
            <Text style={[styles.sizeChipText, orientation === o.id && styles.sizeChipTextOn]}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {product.skus.map((sku) => (
          <View key={sku.id} style={styles.card}>
            <View style={styles.qrBox}>
              <QRCode
                value={sku.barcode}
                size={72}
                getRef={(c) => {
                  if (c) refs.current.set(sku.id, c);
                }}
              />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.name} numberOfLines={1}>
                {product.name}
              </Text>
              <Text style={styles.spec}>
                {sku.color}/{sku.size} · 库存 {sku.stock}
              </Text>
              <Text style={styles.price}>{yuan(sku.salePrice)}</Text>
            </View>
            <View style={styles.stepper}>
              <Pressable
                style={styles.stepBtn}
                onPress={() => setQtyFor(sku.id, (qty[sku.id] ?? 0) - 1)}
              >
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Text style={styles.qtyText}>{qty[sku.id] ?? 0}</Text>
              <Pressable
                style={styles.stepBtn}
                onPress={() => setQtyFor(sku.id, (qty[sku.id] ?? 0) + 1)}
              >
                <Text style={styles.stepText}>＋</Text>
              </Pressable>
            </View>
          </View>
        ))}
        <Text style={styles.hint}>
          二维码内容即该规格的唯一条码，扫码收银可直接匹配。先用普通打印机 +
          不干胶标签纸即可；后续接蓝牙标签机一键打印。
        </Text>
      </ScrollView>

      {isPrinterAvailable ? (
        <View style={styles.btBar}>
          <Text style={styles.btStatus}>
            {connected ? "🟢 蓝牙打印机已连接" : "⚪ 蓝牙打印机未连接"}
          </Text>
          {connected ? (
            <Pressable
              onPress={() => {
                disconnectPrinter();
                setConnected(false);
              }}
              hitSlop={8}
              style={styles.topbarBtn}
            >
              <Text style={styles.btLink}>断开</Text>
            </Pressable>
          ) : (
            <Pressable onPress={openBluetooth} hitSlop={8} style={styles.topbarBtn}>
              <Text style={styles.btLink}>选择设备</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            busy && styles.dim,
            pressed && !busy && styles.secondaryPressed,
          ]}
          disabled={busy}
          onPress={handleSharePdf}
        >
          <Text style={styles.secondaryText}>生成 PDF 分享</Text>
        </Pressable>
        {isPrinterAvailable ? (
          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              (busy || totalLabels === 0) && styles.dim,
              pressed && !(busy || totalLabels === 0) && styles.primaryPressed,
            ]}
            disabled={busy || totalLabels === 0}
            onPress={handleBtPrint}
          >
            <Text style={styles.primaryText}>
              {connected ? `蓝牙打印（${totalLabels}）` : "连接并打印"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              (busy || totalLabels === 0) && styles.dim,
              pressed && !(busy || totalLabels === 0) && styles.primaryPressed,
            ]}
            disabled={busy || totalLabels === 0}
            onPress={handlePrint}
          >
            <Text style={styles.primaryText}>打印 / 导出（{totalLabels}）</Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={btOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setBtOpen(false)}
      >
        <View style={styles.modalMask}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>选择蓝牙打印机</Text>
              <Pressable
                onPress={openBluetooth}
                hitSlop={8}
                disabled={scanning}
                style={styles.topbarBtn}
              >
                <Text style={styles.btLink}>{scanning ? "刷新中…" : "刷新"}</Text>
              </Pressable>
            </View>
            <Text style={styles.modalHint}>
              请先在手机「系统设置 → 蓝牙」里配对打印机，再回到这里选择。
            </Text>
            {scanning ? (
              <ActivityIndicator style={{ marginVertical: space.xl }} color={colors.primary} />
            ) : devices.length === 0 ? (
              <Text style={styles.modalEmpty}>未找到已配对设备</Text>
            ) : (
              <ScrollView style={{ maxHeight: 280 }}>
                {devices.map((d) => (
                  <Pressable
                    key={d.mac}
                    style={({ pressed }) => [styles.devRow, pressed && styles.cardPressed]}
                    disabled={busy}
                    onPress={() => doConnect(d)}
                  >
                    <Text style={styles.devName}>{d.name}</Text>
                    <Text style={styles.devMac}>{d.mac}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable
              style={({ pressed }) => [styles.modalClose, pressed && styles.cardPressed]}
              onPress={() => setBtOpen(false)}
            >
              <Text style={styles.modalCloseText}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  fillLink: { color: colors.primary, fontSize: font.body, fontWeight: "700" },
  sizeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md - 2,
    flexWrap: "wrap",
  },
  sizeLabel: { fontSize: font.caption, color: colors.textMuted, marginRight: space.xs },
  sizeChip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    minHeight: touch.minSize,
    justifyContent: "center",
  },
  sizeChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  sizeChipText: { fontSize: font.caption, color: colors.textMuted, fontWeight: "700" },
  sizeChipTextOn: { color: "#fff" },
  chipPressed: { opacity: 0.7 },
  body: { padding: space.lg, gap: space.md },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
  },
  qrBox: {
    width: 84,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  cardInfo: { flex: 1, gap: 2 },
  name: { fontSize: font.body, fontWeight: "700", color: colors.text },
  spec: { fontSize: font.caption, color: colors.textMuted },
  price: { fontSize: font.body, fontWeight: "800", color: colors.primary },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.sm },
  stepBtn: {
    width: touch.minSize,
    height: touch.minSize,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: font.title, fontWeight: "800", color: colors.primary },
  qtyText: { minWidth: 28, textAlign: "center", fontSize: font.body, fontWeight: "700" },
  hint: { fontSize: font.caption, color: colors.textMuted, lineHeight: 20, marginTop: space.xs },
  footer: {
    flexDirection: "row",
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: radius.md,
    minHeight: touch.buttonHeight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  secondaryPressed: { opacity: 0.7 },
  secondaryText: { color: colors.primary, fontSize: font.body, fontWeight: "700" },
  primaryBtn: {
    flex: 1.4,
    borderRadius: radius.md,
    minHeight: touch.buttonHeight,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  primaryText: { color: "#fff", fontSize: font.body, fontWeight: "800" },
  dim: { opacity: 0.5 },
  btBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  btStatus: { fontSize: font.caption, color: colors.text, fontWeight: "600" },
  btLink: { color: colors.primary, fontSize: font.body, fontWeight: "700" },
  modalMask: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.xl,
    paddingBottom: space.xxl + space.md,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: { fontSize: font.body + 1, fontWeight: "800", color: colors.text },
  modalHint: {
    fontSize: font.caption,
    color: colors.textMuted,
    marginTop: space.xs,
    lineHeight: 20,
  },
  modalEmpty: {
    fontSize: font.body,
    color: colors.textMuted,
    textAlign: "center",
    marginVertical: space.xl,
  },
  devRow: {
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: touch.minSize,
    justifyContent: "center",
  },
  cardPressed: { opacity: 0.7 },
  devName: { fontSize: font.body, fontWeight: "700", color: colors.text },
  devMac: { fontSize: font.caption, color: colors.textMuted, marginTop: 2 },
  modalClose: {
    marginTop: space.lg,
    minHeight: touch.buttonHeight,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  modalCloseText: { fontSize: font.body, fontWeight: "700", color: colors.text },
});
