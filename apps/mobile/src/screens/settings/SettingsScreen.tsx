import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { apiUpdateMyName, apiUpdateShopName } from "../../api";
import { useAuth } from "../../auth-context";
import { BackButton } from "../../components/BackButton";
import { useDialog } from "../../dialog-context";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import { getSaleAlertsOn, setSaleAlertsOn } from "../../storage";
import { colors, font, radius, space, touch } from "../../theme/tokens";
import { UpdateSheet } from "./UpdateSheet";

type SettingsNav = NativeStackNavigationProp<RootStackParamList, "Settings">;

const APP_VERSION = Constants.expoConfig?.version ?? "?";
const VERSION_CODE = String(Constants.expoConfig?.android?.versionCode ?? "?");

/**
 * 设置中心（首页右上角齿轮进入）：账户管理 + APP 管理。
 * 店长：改密码（复用 ChangePassword 屏）/ 改注册店铺名（同步首页店名）/ 手机号只读 /
 *       结账提醒开关 / 版本号 / 检查更新 / 退出登录。
 * 店员：改名字 / 密码·手机号只读 / 版本号 / 检查更新 / 退出登录。
 * 手机号即登录账号，任何角色都不可改。
 */
export function SettingsScreen() {
  const navigation = useNavigation<SettingsNav>();
  const { user, logout, updateUser } = useAuth();
  const { confirm, notice } = useDialog();
  const isOwner = user?.role === "owner";

  const [nameSheet, setNameSheet] = useState(false);
  const [shopSheet, setShopSheet] = useState(false);
  const [updateSheet, setUpdateSheet] = useState(false);
  const [alertsOn, setAlertsOn] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    void getSaleAlertsOn().then(setAlertsOn);
  }, []);

  async function toggleAlerts(v: boolean) {
    setAlertsOn(v);
    await setSaleAlertsOn(v);
    if (!v) return;
    // 重新打开时若系统权限未授予，主动请求一次（被永久拒绝时静默，用户需去系统设置）
    try {
      const perm = await Notifications.getPermissionsAsync();
      if (!perm.granted) await Notifications.requestPermissionsAsync();
    } catch {
      // 忽略
    }
  }

  async function doLogout() {
    const ok = await confirm({
      title: "退出登录",
      message: "退出后需重新输入手机号和密码登录",
      confirmLabel: "退出",
      destructive: true,
    });
    if (!ok) return;
    setLoggingOut(true);
    await logout();
  }

  if (!user) return null;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>设置</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* 用户卡 */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name.slice(0, 1)}</Text>
          </View>
          <View style={styles.profileCol}>
            <Text style={styles.profileName} numberOfLines={1}>
              {user.name}
            </Text>
            <View style={styles.profileMeta}>
              <View
                style={[styles.rolePill, isOwner ? styles.rolePillOwner : styles.rolePillStaff]}
              >
                <Text
                  style={[
                    styles.rolePillText,
                    isOwner ? styles.rolePillTextOwner : styles.rolePillTextStaff,
                  ]}
                >
                  {isOwner ? "老板" : "店员"}
                </Text>
              </View>
              {user.shopName ? (
                <View style={styles.shopRow}>
                  <Ionicons name="storefront-outline" size={12} color={colors.gold} />
                  <Text style={styles.shopText} numberOfLines={1}>
                    {user.shopName}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* 账号设置 */}
        <Text style={styles.sectionLabel}>账号</Text>
        <View style={styles.card}>
          {isOwner ? (
            <Row
              icon="key-outline"
              label="修改密码"
              onPress={() => navigation.navigate("ChangePassword")}
            />
          ) : (
            <Row
              icon="person-outline"
              label="修改名字"
              value={user.name}
              onPress={() => setNameSheet(true)}
            />
          )}
          {isOwner ? (
            <Row
              icon="storefront-outline"
              label="注册店铺名"
              value={user.shopName || undefined}
              onPress={() => setShopSheet(true)}
            />
          ) : (
            <Row
              icon="lock-closed-outline"
              label="密码"
              value="由店主管理"
              hint="如需修改，请联系店主在「店员管理」中重置"
            />
          )}
          <Row
            icon="phone-portrait-outline"
            label="手机号"
            value={user.phone}
            last
            hint="登录账号，不可修改"
          />
        </View>

        {/* 应用设置 */}
        <Text style={styles.sectionLabel}>应用</Text>
        <View style={styles.card}>
          {isOwner ? (
            <View style={styles.row}>
              <View style={styles.iconBox}>
                <Ionicons name="notifications-outline" size={19} color={colors.primary} />
              </View>
              <View style={styles.rowMain}>
                <Text style={styles.rowLabel}>结账提醒</Text>
                <Text style={styles.rowHint}>店员开单时提醒（声音 + 通知）</Text>
              </View>
              <Switch
                value={alertsOn}
                onValueChange={(v) => void toggleAlerts(v)}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
                accessibilityLabel="结账提醒开关"
              />
            </View>
          ) : null}
          <Row
            icon="information-circle-outline"
            label="版本号"
            value={`v${APP_VERSION} (${VERSION_CODE})`}
          />
          <Row
            icon="arrow-down-circle-outline"
            label="检查更新"
            chevron
            last
            onPress={() => setUpdateSheet(true)}
          />
        </View>

        {/* 退出登录 */}
        <Pressable
          style={styles.logoutCard}
          onPress={() => void doLogout()}
          disabled={loggingOut}
          android_ripple={{ color: "#FEE2E2" }}
          accessibilityRole="button"
          accessibilityLabel="退出登录"
        >
          {loggingOut ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={19} color={colors.danger} />
              <Text style={styles.logoutText}>退出登录</Text>
            </>
          )}
        </Pressable>
      </ScrollView>

      <TextEditSheet
        visible={nameSheet}
        title="修改名字"
        placeholder="输入新名字"
        initial={user.name}
        maxLength={20}
        onClose={() => setNameSheet(false)}
        onSubmit={async (text) => {
          const updated = await apiUpdateMyName({ name: text });
          updateUser(updated);
          await notice("已修改");
        }}
      />
      <TextEditSheet
        visible={shopSheet}
        title="修改注册店铺名"
        placeholder="输入新的店铺名"
        initial={user.shopName}
        maxLength={40}
        onClose={() => setShopSheet(false)}
        onSubmit={async (text) => {
          const updated = await apiUpdateShopName({ shopName: text });
          updateUser(updated);
          await notice("已修改", "首页店铺名将同步更新");
        }}
      />
      <UpdateSheet visible={updateSheet} onClose={() => setUpdateSheet(false)} />
    </View>
  );
}

/* ------------------------------ 通用行组件 ------------------------------ */

function Row({
  icon,
  label,
  value,
  hint,
  chevron,
  last,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  hint?: string;
  chevron?: boolean;
  last?: boolean;
  onPress?: () => void;
}) {
  const inner = (
    <>
      <View style={styles.iconBox}>
        <Ionicons name={icon} size={19} color={colors.primary} />
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {chevron || onPress ? (
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      ) : null}
    </>
  );
  if (!onPress) {
    return <View style={[styles.row, last && styles.rowLast]}>{inner}</View>;
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, last && styles.rowLast]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {inner}
    </Pressable>
  );
}

/* ------------------------------ 文本编辑弹层 ------------------------------ */

function TextEditSheet({
  visible,
  title,
  placeholder,
  initial,
  maxLength,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  initial: string;
  maxLength: number;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setValue(initial);
      setError(null);
      setSubmitting(false);
    }
  }, [visible, initial]);

  async function submit() {
    const text = value.trim();
    if (!text) {
      setError("不能为空");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(text);
      onClose();
    } catch (e) {
      setError((e as Error).message || "修改失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheetCard}>
        <Text style={styles.sheetTitle}>{title}</Text>
        <TextInput
          style={styles.sheetInput}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          value={value}
          maxLength={maxLength}
          autoFocus
          onChangeText={(t) => {
            setError(null);
            setValue(t);
          }}
          onSubmitEditing={() => void submit()}
        />
        {error ? <Text style={styles.sheetError}>{error}</Text> : null}
        <View style={styles.sheetBtns}>
          <Pressable style={styles.sheetCancel} onPress={onClose} disabled={submitting}>
            <Text style={styles.sheetCancelText}>取消</Text>
          </Pressable>
          <Pressable
            style={[styles.sheetOk, submitting && styles.btnDisabled]}
            onPress={() => void submit()}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.sheetOkText}>保存</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/* --------------------------------- 样式 --------------------------------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  placeholder: { width: 32 },
  scroll: { flex: 1 },
  body: {
    padding: space.xl,
    gap: space.md,
    paddingBottom: space.xxl + 24,
  },

  // 用户卡
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.xl,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 22, fontWeight: "800", color: colors.primary },
  profileCol: { flex: 1, gap: 6, minWidth: 0 },
  profileName: { fontSize: font.title, fontWeight: "800", color: colors.text },
  profileMeta: { flexDirection: "row", alignItems: "center", gap: space.sm },
  rolePill: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  rolePillOwner: { backgroundColor: "rgba(192,160,101,0.16)" },
  rolePillStaff: { backgroundColor: colors.primarySoft },
  rolePillText: { fontSize: 10, fontWeight: "800" },
  rolePillTextOwner: { color: "#8A6D3B" },
  rolePillTextStaff: { color: colors.primary },
  shopRow: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  shopText: { fontSize: font.caption, fontWeight: "600", color: colors.textMuted },

  sectionLabel: {
    fontSize: font.caption,
    fontWeight: "700",
    color: colors.textMuted,
    marginTop: space.sm,
    marginBottom: -space.xs,
    paddingLeft: space.xs,
    letterSpacing: 1,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: touch.minSize + 8,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowPressed: { backgroundColor: "#FAFBFC" },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowMain: { flex: 1, gap: 2, minWidth: 0 },
  rowLabel: { fontSize: font.body, fontWeight: "600", color: colors.text },
  rowHint: { fontSize: font.caption - 1, color: colors.textMuted, fontWeight: "500" },
  rowValue: {
    fontSize: font.caption,
    color: colors.textMuted,
    fontWeight: "600",
    maxWidth: 150,
    flexShrink: 1,
  },

  logoutCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    height: touch.buttonHeight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    marginTop: space.md,
  },
  logoutText: { fontSize: font.body, fontWeight: "700", color: colors.danger },

  // 文本编辑弹层（底部滑入）
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
  },
  sheetCard: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl + 4,
    borderTopRightRadius: radius.xl + 4,
    padding: space.xxl,
    paddingBottom: space.xxl + 10,
    gap: space.md,
  },
  sheetTitle: { fontSize: font.title, fontWeight: "800", color: colors.text, textAlign: "center" },
  sheetInput: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: touch.buttonHeight,
    fontSize: font.body,
    color: colors.text,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  sheetError: { fontSize: font.caption, color: colors.danger, fontWeight: "700" },
  sheetBtns: { flexDirection: "row", gap: space.md },
  sheetCancel: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    height: touch.buttonHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetCancelText: { color: colors.textMuted, fontSize: font.body, fontWeight: "700" },
  sheetOk: {
    flex: 2,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: touch.buttonHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetOkText: { color: "#fff", fontSize: font.body, fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },
});
