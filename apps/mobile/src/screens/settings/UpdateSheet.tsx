import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Updates from "expo-updates";
import * as LegacyFS from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { getApkManifest, type ApkManifest } from "../../api";
import { API_HOST } from "../../config";
import { colors, font, radius, space, touch } from "../../theme/tokens";

/**
 * 应用内更新二级界面（设置页 → 检查更新）。
 *
 * 双通道自动判断：
 * 1. 下载页 manifest 版本 > 当前 App 版本 → APK 更新（原生改动）：
 *    断点下载（真实进度条）→ 自动拉起系统安装器 → 用户点「安装」后系统升级并重开 App。
 * 2. 否则查 OTA（纯 JS 改动）：fetchUpdateAsync → 3 秒倒计时自动 reloadAsync 重启。
 *
 * 兜底：安装器被 ROM 拦截时可跳系统浏览器打开 /download 手动安装。
 */

const CURRENT_VERSION = Constants.expoConfig?.version ?? "0.0.0";

/** "1.10.0" > "1.9.0" 之类的三段版本比较 */
function versionGt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

type Phase =
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "ota-ready" }
  | { kind: "ota-downloading" }
  | { kind: "ota-done"; countdown: number }
  | { kind: "apk-ready"; manifest: ApkManifest }
  | { kind: "apk-downloading"; manifest: ApkManifest; received: number }
  | { kind: "apk-install"; manifest: ApkManifest }
  | { kind: "error"; message: string };

const APK_CACHE_PATH = `${LegacyFS.cacheDirectory}cloth-scan-update.apk`;

export function UpdateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 打开即自动开始检查 */
  useEffect(() => {
    if (visible) {
      setPhase({ kind: "checking" });
      void startCheck();
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (latestTimer.current) clearTimeout(latestTimer.current);
    };
  }, [visible]);

  const startCheck = useCallback(async () => {
    setPhase({ kind: "checking" });
    // ① APK 通道：manifest 版本 > 当前版本 → 原生更新
    try {
      const m = await getApkManifest();
      if (m.version && versionGt(m.version, CURRENT_VERSION)) {
        setPhase({ kind: "apk-ready", manifest: m });
        return;
      }
    } catch {
      // manifest 不可达（离线/服务器维护）：继续查 OTA
    }
    // ② OTA 通道：同 runtimeVersion 内的 JS 更新
    try {
      const upd = await Updates.checkForUpdateAsync();
      if (upd.isAvailable) {
        setPhase({ kind: "ota-ready" });
        return;
      }
    } catch {
      // Expo Go / 无 updates 环境：视为无更新
    }
    setPhase({ kind: "latest" });
    if (latestTimer.current) clearTimeout(latestTimer.current);
    latestTimer.current = setTimeout(onClose, 1600);
  }, [onClose]);

  /** OTA：下载 JS 包 → 3 秒倒计时自动重启 */
  const runOta = useCallback(async () => {
    setPhase({ kind: "ota-downloading" });
    try {
      await Updates.fetchUpdateAsync();
      setPhase({ kind: "ota-done", countdown: 3 });
      countdownRef.current = setInterval(() => {
        setPhase((p) => {
          if (p.kind !== "ota-done") return p;
          if (p.countdown <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            void Updates.reloadAsync();
            return p;
          }
          return { ...p, countdown: p.countdown - 1 };
        });
      }, 1000);
    } catch (e) {
      setPhase({ kind: "error", message: `更新包下载失败：${(e as Error).message}` });
    }
  }, []);

  /** APK：断点下载（进度条）→ 自动拉起系统安装器 */
  const runApkDownload = useCallback(async (m: ApkManifest) => {
    setPhase({ kind: "apk-downloading", manifest: m, received: 0 });
    try {
      await LegacyFS.deleteAsync(APK_CACHE_PATH, { idempotent: true });
    } catch {
      // 无旧包
    }
    const dl = LegacyFS.createDownloadResumable(m.url, APK_CACHE_PATH, {}, (d) => {
      setPhase((p) => (p.kind === "apk-downloading" ? { ...p, received: d.totalBytesWritten } : p));
    });
    try {
      const res = await dl.downloadAsync();
      if (!res) throw new Error("下载未完成，请重试");
      setPhase({ kind: "apk-install", manifest: m });
      await launchInstaller(res.uri);
    } catch (e) {
      setPhase({
        kind: "error",
        message: `安装包下载失败：${(e as Error).message}。可点下方「浏览器下载」手动安装。`,
      });
    }
  }, []);

  const launchInstaller = useCallback(async (uri?: string) => {
    const target = uri ?? APK_CACHE_PATH;
    try {
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: target,
        type: "application/vnd.android.package-archive",
        // 1 = Intent.FLAG_GRANT_READ_URI_PERMISSION：授权安装器读取缓存目录里的 APK
        flags: 1,
      });
    } catch {
      setPhase({
        kind: "error",
        message:
          "无法打开系统安装器（部分手机需在系统设置允许「安装未知应用」）。可点下方「浏览器下载」手动安装。",
      });
    }
  }, []);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View pointerEvents="box-none" style={styles.center}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>检查更新</Text>
          <Text style={styles.cardSub}>当前版本 v{CURRENT_VERSION}</Text>

          {phase.kind === "checking" ? (
            <View style={styles.body}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.bodyText}>正在检查新版本…</Text>
            </View>
          ) : null}

          {phase.kind === "latest" ? (
            <View style={styles.body}>
              <Ionicons name="checkmark-circle" size={44} color={colors.online} />
              <Text style={styles.bodyText}>已是最新版本</Text>
            </View>
          ) : null}

          {phase.kind === "ota-ready" ||
          phase.kind === "ota-downloading" ||
          phase.kind === "ota-done" ? (
            <View style={styles.body}>
              <Ionicons name="download" size={40} color={colors.primary} />
              <Text style={styles.phaseTitle}>发现新版本</Text>
              <Text style={styles.bodyText}>
                {phase.kind === "ota-ready"
                  ? "应用内更新，无需重装安装包"
                  : phase.kind === "ota-downloading"
                    ? "正在下载更新…"
                    : `更新完成，${phase.countdown} 秒后自动重启`}
              </Text>
              <Pressable
                style={[styles.primaryBtn, phase.kind !== "ota-ready" && styles.btnDisabled]}
                disabled={phase.kind !== "ota-ready"}
                onPress={() => void runOta()}
              >
                <Text style={styles.primaryBtnText}>
                  {phase.kind === "ota-ready"
                    ? "立即更新"
                    : phase.kind === "ota-downloading"
                      ? "下载中…"
                      : "立即重启"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {phase.kind === "apk-ready" ||
          phase.kind === "apk-downloading" ||
          phase.kind === "apk-install" ? (
            <View style={styles.body}>
              <Ionicons name="arrow-down-circle" size={40} color={colors.primary} />
              <Text style={styles.phaseTitle}>新版本 v{phase.manifest.version}</Text>
              {phase.manifest.note ? (
                <Text style={styles.noteText}>{phase.manifest.note}</Text>
              ) : null}

              {phase.kind === "apk-ready" ? (
                <Text style={styles.bodyText}>
                  安装包 {(phase.manifest.sizeBytes / 1024 / 1024).toFixed(1)}{" "}
                  MB，下载后自动打开安装
                </Text>
              ) : phase.kind === "apk-downloading" ? (
                <Progress received={phase.received} total={phase.manifest.sizeBytes} />
              ) : (
                <Text style={styles.bodyText}>下载完成，已为你打开系统安装</Text>
              )}

              {phase.kind === "apk-ready" ? (
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => void runApkDownload(phase.manifest)}
                >
                  <Text style={styles.primaryBtnText}>立即更新</Text>
                </Pressable>
              ) : phase.kind === "apk-install" ? (
                <Pressable style={styles.secondaryBtn} onPress={() => void launchInstaller()}>
                  <Text style={styles.secondaryBtnText}>重新打开安装</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {phase.kind === "error" ? (
            <View style={styles.body}>
              <Ionicons name="warning" size={40} color={colors.warn} />
              <Text style={styles.errorText}>{phase.message}</Text>
              <View style={styles.btnRow}>
                <Pressable style={[styles.secondaryBtn, styles.flex1]} onPress={onClose}>
                  <Text style={styles.secondaryBtnText}>稍后再说</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtn, styles.flex1]}
                  onPress={() => void startCheck()}
                >
                  <Text style={styles.primaryBtnText}>重试</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {phase.kind === "apk-downloading" && phase.received === 0 ? (
            <FallbackLink />
          ) : phase.kind === "apk-install" || phase.kind === "error" ? (
            <FallbackLink />
          ) : null}

          {phase.kind !== "apk-downloading" && phase.kind !== "ota-downloading" ? (
            <Pressable style={styles.closeRow} onPress={onClose} hitSlop={6}>
              <Text style={styles.closeText}>关闭</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Progress({ received, total }: { received: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.progressText}>
        {pct}% · {(received / 1024 / 1024).toFixed(1)} / {(total / 1024 / 1024).toFixed(1)} MB
      </Text>
    </View>
  );
}

/** 兜底：浏览器打开下载页手动安装（国产 ROM 拦截安装器时） */
function FallbackLink() {
  if (Platform.OS !== "android") return null;
  return (
    <Pressable
      style={styles.fallbackRow}
      onPress={() => void Linking.openURL(`${API_HOST}/download`)}
    >
      <Ionicons name="open-outline" size={13} color={colors.textMuted} />
      <Text style={styles.fallbackText}>浏览器下载页手动安装</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xxl,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: space.xxl,
    gap: space.sm,
  },
  cardTitle: { fontSize: font.title, fontWeight: "800", color: colors.text, textAlign: "center" },
  cardSub: {
    fontSize: font.caption,
    color: colors.textMuted,
    textAlign: "center",
    fontWeight: "600",
  },
  body: { alignItems: "center", gap: space.md, paddingVertical: space.lg },
  bodyText: {
    fontSize: font.body,
    color: colors.textMuted,
    fontWeight: "600",
    textAlign: "center",
  },
  phaseTitle: { fontSize: font.body + 2, fontWeight: "800", color: colors.text },
  noteText: {
    fontSize: font.caption,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  errorText: { fontSize: font.body, color: colors.danger, fontWeight: "600", textAlign: "center" },
  primaryBtn: {
    backgroundColor: colors.primary,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.xs,
  },
  primaryBtnText: { color: "#fff", fontSize: font.body, fontWeight: "700" },
  secondaryBtn: {
    borderWidth: 1.5,
    borderColor: colors.border,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.xs,
  },
  secondaryBtnText: { color: colors.textMuted, fontSize: font.body, fontWeight: "700" },
  btnRow: { flexDirection: "row", gap: space.md, alignSelf: "stretch" },
  flex1: { flex: 1 },
  btnDisabled: { opacity: 0.55 },
  progressWrap: { alignSelf: "stretch", gap: space.xs, marginVertical: space.sm },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  progressText: {
    fontSize: font.caption,
    color: colors.textMuted,
    fontWeight: "700",
    textAlign: "center",
  },
  fallbackRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: space.xs,
  },
  fallbackText: { fontSize: font.caption, color: colors.textMuted, fontWeight: "600" },
  closeRow: { alignItems: "center", paddingVertical: space.xs },
  closeText: { fontSize: font.caption, color: colors.textMuted, fontWeight: "700" },
});
