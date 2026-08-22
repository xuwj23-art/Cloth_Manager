import { useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { BackButton } from "../components/BackButton";
import { useDialog } from "../dialog-context";
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
      </div>
    </div>`,
    )
    .join("");
  // 居中竖排：大二维码（主视觉）→ SKU 条码
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    *{box-sizing:border-box;}
    body{margin:0;padding:4mm;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;}
    .label{border:1px dashed #bbb;margin:1mm;float:left;overflow:hidden;
      display:flex;align-items:center;justify-content:center;}
    .inner{display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:1.5mm;overflow:hidden;}
    .qr{height:64%;width:auto;aspect-ratio:1;}
    .code{font-size:7pt;letter-spacing:0.3px;color:#222;margin-top:1.2mm;
      max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;}
  </style></head><body>${cells}</body></html>`;
}

export function LabelPrintScreen() {
  const navigation = useNavigation<LabelPrintNav>();
  const route = useRoute<LabelPrintRoute>();
  const { notice } = useDialog();
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
        await notice("请选择打印份数");
        return;
      }
      await Print.printAsync({ html: buildLabelsHtml(labels, size, orientation) });
    } catch (e) {
      await notice("打印失败", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSharePdf() {
    setBusy(true);
    try {
      const labels = await collectLabels();
      if (labels.length === 0) {
        await notice("请选择打印份数");
        return;
      }
      const { uri } = await Print.printToFileAsync({
        html: buildLabelsHtml(labels, size, orientation),
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
      } else {
        await notice("已生成 PDF");
      }
    } catch (e) {
      await notice("生成失败", (e as Error).message);
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
      await notice("无法读取蓝牙设备", (e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function doConnect(dev: CtBondedDevice) {
    if (busy) return;
    setBusy(true);
    try {
      await connectPrinterAuto(dev.mac);
      setConnected(true);
      setBtOpen(false);
      await notice("已连接", dev.name);
    } catch (e) {
      const msg = (e as Error).message;
      // 若是权限/位置类失败，且系统定位没开，给出更明确指引
      if (/权限|516|位置/.test(msg) && !isLocationEnabled()) {
        await notice("连接失败", "请打开手机定位后重试");
      } else {
        await notice("连接失败", msg);
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
      await notice("请选择打印份数");
      return;
    }
    setBusy(true);
    try {
      await printJob(job);
      await notice("已发送打印", `${totalLabelCount(job)} 张`);
    } catch (e) {
      await notice("打印失败", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const totalLabels = product.skus.reduce((s, k) => s + (qty[k.id] ?? 0), 0);

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>打印吊牌</Text>
        <Pressable onPress={fillByStock} hitSlop={8}>
          <Text style={styles.fillLink}>按库存</Text>
        </Pressable>
      </View>

      <View style={styles.sizeRow}>
        <Text style={styles.sizeLabel}>标签尺寸(mm)</Text>
        {LABEL_SIZES.map((s) => (
          <Pressable
            key={s.id}
            style={[styles.sizeChip, size.id === s.id && styles.sizeChipOn]}
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
            style={[styles.sizeChip, orientation === o.id && styles.sizeChipOn]}
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
            >
              <Text style={styles.btLink}>断开</Text>
            </Pressable>
          ) : (
            <Pressable onPress={openBluetooth} hitSlop={8}>
              <Text style={styles.btLink}>选择设备</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      <View style={styles.footer}>
        <Pressable
          style={[styles.secondaryBtn, busy && styles.dim]}
          disabled={busy}
          onPress={handleSharePdf}
        >
          <Text style={styles.secondaryText}>生成 PDF 分享</Text>
        </Pressable>
        {isPrinterAvailable ? (
          <Pressable
            style={[styles.primaryBtn, (busy || totalLabels === 0) && styles.dim]}
            disabled={busy || totalLabels === 0}
            onPress={handleBtPrint}
          >
            <Text style={styles.primaryText}>
              {connected ? `蓝牙打印（${totalLabels}）` : "连接并打印"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primaryBtn, (busy || totalLabels === 0) && styles.dim]}
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
              <Pressable onPress={openBluetooth} hitSlop={8} disabled={scanning}>
                <Text style={styles.btLink}>{scanning ? "刷新中…" : "刷新"}</Text>
              </Pressable>
            </View>
            <Text style={styles.modalHint}>
              请先在手机「系统设置 → 蓝牙」里配对打印机，再回到这里选择。
            </Text>
            {scanning ? (
              <ActivityIndicator style={{ marginVertical: 20 }} />
            ) : devices.length === 0 ? (
              <Text style={styles.modalEmpty}>未找到已配对设备</Text>
            ) : (
              <ScrollView style={{ maxHeight: 280 }}>
                {devices.map((d) => (
                  <Pressable
                    key={d.mac}
                    style={styles.devRow}
                    disabled={busy}
                    onPress={() => doConnect(d)}
                  >
                    <Text style={styles.devName}>{d.name}</Text>
                    <Text style={styles.devMac}>{d.mac}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable style={styles.modalClose} onPress={() => setBtOpen(false)}>
              <Text style={styles.modalCloseText}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  fillLink: { color: "#2563eb", fontSize: 14, fontWeight: "700" },
  sizeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sizeLabel: { fontSize: 13, color: "#6b7280", marginRight: 4 },
  sizeChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  sizeChipOn: { backgroundColor: "#2563eb" },
  sizeChipText: { fontSize: 13, color: "#6b7280", fontWeight: "600" },
  sizeChipTextOn: { color: "#fff" },
  body: { padding: 16, gap: 10 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
  },
  qrBox: {
    width: 84,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  cardInfo: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: "700", color: "#111" },
  spec: { fontSize: 13, color: "#6b7280" },
  price: { fontSize: 15, fontWeight: "800", color: "#111" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 18, fontWeight: "700", color: "#111" },
  qtyText: { minWidth: 24, textAlign: "center", fontSize: 16, fontWeight: "700" },
  hint: { fontSize: 12, color: "#9ca3af", lineHeight: 18, marginTop: 4 },
  footer: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#2563eb",
  },
  secondaryText: { color: "#2563eb", fontSize: 15, fontWeight: "700" },
  primaryBtn: {
    flex: 1.4,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#2563eb",
  },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  dim: { opacity: 0.5 },
  btBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  btStatus: { fontSize: 13, color: "#374151", fontWeight: "600" },
  btLink: { color: "#2563eb", fontSize: 14, fontWeight: "700" },
  modalMask: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
    paddingBottom: 28,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: { fontSize: 17, fontWeight: "800", color: "#111" },
  modalHint: { fontSize: 12, color: "#9ca3af", marginTop: 6, lineHeight: 18 },
  modalEmpty: { fontSize: 14, color: "#9ca3af", textAlign: "center", marginVertical: 24 },
  devRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  devName: { fontSize: 15, fontWeight: "700", color: "#111" },
  devMac: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  modalClose: {
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#f3f4f6",
  },
  modalCloseText: { fontSize: 15, fontWeight: "700", color: "#374151" },
});
