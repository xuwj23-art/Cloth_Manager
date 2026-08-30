import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import type { ShopMember } from "@cloth-scan/shared";
import { apiCreateStaff, apiDeleteStaff, apiListStaff, apiResetStaffPassword } from "../api";
import { BackButton } from "../components/BackButton";
import { useDialog } from "../dialog-context";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space, touch } from "../theme/tokens";

type StaffNav = NativeStackNavigationProp<RootStackParamList, "Staff">;

/**
 * 店员管理（v1.5.0 重构，参考 GroupMe Members 骨架 + Instacart/Monarch 模式）：
 * - 店主单独分组、零操作（改自己密码走设置页）；
 * - 店员行只放「头像/姓名/手机号 + chevron」，点开底部弹层收纳「重置密码/删除」，
 *   红色只出现在二次确认——不再把两个按钮常驻堆在行尾；
 * - 「添加店员」为底部固定主按钮，弹底部表单（替代旧的常驻列表头表单）。
 */
export function StaffScreen() {
  const navigation = useNavigation<StaffNav>();
  const { confirm, notice } = useDialog();
  const [members, setMembers] = useState<ShopMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<ShopMember | null>(null);
  const [resetTarget, setResetTarget] = useState<ShopMember | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMembers(await apiListStaff());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const owner = members.find((m) => m.role === "owner");
  const staff = members.filter((m) => m.role === "staff");

  async function deleteMember(m: ShopMember) {
    const ok = await confirm({
      title: "删除店员",
      message: `确定删除「${m.name}」？删除后该账号立即无法登录。`,
      confirmLabel: "删除",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiDeleteStaff(m.id);
      setActionTarget(null);
      await load();
    } catch (e) {
      await notice("删除失败", (e as Error).message);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>店员管理</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>店主</Text>
        <View style={styles.card}>
          {owner ? <MemberRow name={owner.name} sub={owner.phone} staticRow /> : null}
        </View>

        <Text style={styles.sectionLabel}>店员{staff.length > 0 ? ` · ${staff.length}` : ""}</Text>
        <View style={styles.card}>
          {loading && members.length === 0 ? (
            <ActivityIndicator style={{ marginVertical: 20 }} />
          ) : staff.length === 0 ? (
            <Text style={styles.empty}>还没有店员，点下方按钮添加</Text>
          ) : (
            staff.map((m, i) => (
              <View key={m.id}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <MemberRow name={m.name} sub={m.phone} onPress={() => setActionTarget(m)} />
              </View>
            ))
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </ScrollView>

      <View style={styles.ctaWrap}>
        <Pressable
          style={styles.cta}
          onPress={() => setAddOpen(true)}
          android_ripple={{ color: colors.primaryPressed }}
          accessibilityRole="button"
          accessibilityLabel="添加店员"
        >
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={styles.ctaText}>添加店员</Text>
        </Pressable>
      </View>

      <AddStaffSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={async () => {
          setAddOpen(false);
          await notice("已添加");
          await load();
        }}
      />

      {/* 店员操作弹层 */}
      <Modal
        visible={actionTarget !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setActionTarget(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionTarget(null)} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHead}>
            <View style={styles.sheetAvatar}>
              <Text style={styles.sheetAvatarText}>{actionTarget?.name.slice(0, 1)}</Text>
            </View>
            <View style={styles.sheetHeadCol}>
              <Text style={styles.sheetName}>{actionTarget?.name}</Text>
              <Text style={styles.sheetSub}>{actionTarget?.phone}</Text>
            </View>
          </View>

          <Pressable
            style={styles.actionBtn}
            onPress={() => {
              if (!actionTarget) return;
              setResetTarget(actionTarget);
              setActionTarget(null);
            }}
            android_ripple={{ color: colors.primarySoft }}
            accessibilityRole="button"
            accessibilityLabel="重置密码"
          >
            <Ionicons name="key-outline" size={19} color={colors.primary} />
            <Text style={styles.actionBtnText}>重置密码</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.actionDanger]}
            onPress={() => actionTarget && void deleteMember(actionTarget)}
            android_ripple={{ color: colors.dangerSoft }}
            accessibilityRole="button"
            accessibilityLabel="删除店员"
          >
            <Ionicons name="trash-outline" size={19} color={colors.danger} />
            <Text style={[styles.actionBtnText, { color: colors.danger }]}>删除店员</Text>
          </Pressable>
          <Pressable style={styles.actionCancel} onPress={() => setActionTarget(null)}>
            <Text style={styles.actionCancelText}>取消</Text>
          </Pressable>
        </View>
      </Modal>

      {/* 重置密码弹层 */}
      <ResetSheet
        target={resetTarget}
        onClose={() => setResetTarget(null)}
        onDone={async () => {
          setResetTarget(null);
          await notice("密码已重置");
        }}
      />
    </View>
  );
}

/* ------------------------------ 成员行 ------------------------------ */

function MemberRow({
  name,
  sub,
  staticRow,
  onPress,
}: {
  name: string;
  sub: string;
  /** 店主行：无操作、无 chevron */
  staticRow?: boolean;
  onPress?: () => void;
}) {
  const inner = (
    <>
      <View style={[styles.avatar, staticRow && styles.avatarOwner]}>
        <Text style={[styles.avatarText, staticRow && styles.avatarTextOwner]}>
          {name.slice(0, 1)}
        </Text>
      </View>
      <View style={styles.memberCol}>
        <Text style={styles.memberName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.memberSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {!staticRow ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
    </>
  );
  if (staticRow || !onPress) {
    return <View style={styles.memberRow}>{inner}</View>;
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.memberRow, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`店员 ${name}`}
    >
      {inner}
    </Pressable>
  );
}

/* ------------------------------ 添加店员弹层 ------------------------------ */

function AddStaffSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName("");
      setPhone("");
      setPassword("");
      setError(null);
      setSubmitting(false);
    }
  }, [visible]);

  async function submit() {
    if (!name.trim() || !phone.trim() || password.length < 6) {
      setError("请填写完整（初始密码至少 6 位）");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiCreateStaff({ name: name.trim(), phone: phone.trim(), password });
      await onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheetCard}>
        <Text style={styles.sheetTitle}>添加店员</Text>
        <Text style={styles.sheetHint}>店员用手机号 + 初始密码登录</Text>
        <TextInput
          style={styles.input}
          placeholder="姓名"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={(t) => {
            setError(null);
            setName(t);
          }}
        />
        <TextInput
          style={styles.input}
          placeholder="手机号"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          value={phone}
          onChangeText={(t) => {
            setError(null);
            setPhone(t);
          }}
        />
        <TextInput
          style={styles.input}
          placeholder="初始密码（至少 6 位）"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={(t) => {
            setError(null);
            setPassword(t);
          }}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.sheetBtns}>
          <Pressable style={styles.cancelBtn} onPress={onClose} disabled={submitting}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
          <Pressable
            style={[styles.okBtn, submitting && styles.btnDisabled]}
            onPress={() => void submit()}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.okText}>添加</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------ 重置密码弹层 ------------------------------ */

function ResetSheet({
  target,
  onClose,
  onDone,
}: {
  target: ShopMember | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [pwd, setPwd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setPwd("");
      setError(null);
      setSubmitting(false);
    }
  }, [target]);

  async function submit() {
    if (!target) return;
    if (pwd.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiResetStaffPassword(target.id, pwd);
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheetCard}>
        <Text style={styles.sheetTitle}>重置密码</Text>
        <Text style={styles.sheetHint}>
          {target?.name} · {target?.phone}
        </Text>
        <TextInput
          style={styles.input}
          placeholder="新密码（至少 6 位）"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoFocus
          value={pwd}
          onChangeText={(t) => {
            setError(null);
            setPwd(t);
          }}
          onSubmitEditing={() => void submit()}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.sheetBtns}>
          <Pressable style={styles.cancelBtn} onPress={onClose} disabled={submitting}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
          <Pressable
            style={[styles.okBtn, submitting && styles.btnDisabled]}
            onPress={() => void submit()}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.okText}>确定</Text>
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
  body: { padding: space.xl, paddingBottom: space.xxl, gap: space.md },

  sectionLabel: {
    fontSize: font.caption,
    fontWeight: "700",
    color: colors.textMuted,
    marginBottom: -space.xs,
    paddingLeft: space.xs,
    letterSpacing: 1,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 68,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
  },
  rowLast: { borderBottomWidth: 0 },
  /** 行间内嵌分隔线：从头像右侧文字起点开始，不到卡片左右边缘（更轻盈） */
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: space.lg + 40 + space.md,
  },
  rowPressed: { backgroundColor: "#FAFBFC" },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarOwner: { backgroundColor: "rgba(192,160,101,0.16)" },
  avatarText: { fontSize: 16, fontWeight: "800", color: colors.primary },
  avatarTextOwner: { color: "#8A6D3B" },
  memberCol: { flex: 1, gap: 2, minWidth: 0 },
  memberName: { fontSize: font.body, fontWeight: "700", color: colors.text },
  memberSub: { fontSize: font.caption - 1, color: colors.textMuted, fontWeight: "500" },
  empty: { textAlign: "center", color: colors.textMuted, paddingVertical: 20, fontSize: font.body },
  error: { color: colors.danger, fontWeight: "600", fontSize: font.caption },

  ctaWrap: { padding: space.xl, paddingTop: space.md },
  cta: {
    backgroundColor: colors.primary,
    height: touch.buttonHeight,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  ctaText: { color: "#fff", fontSize: font.body + 2, fontWeight: "700" },

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
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetAvatarText: { fontSize: 16, fontWeight: "800", color: colors.primary },
  sheetHeadCol: { flex: 1, gap: 2 },
  sheetName: { fontSize: font.title, fontWeight: "800", color: colors.text },
  sheetSub: { fontSize: font.caption, color: colors.textMuted, fontWeight: "600" },
  sheetTitle: { fontSize: font.title, fontWeight: "800", color: colors.text, textAlign: "center" },
  sheetHint: {
    fontSize: font.caption,
    color: colors.textMuted,
    textAlign: "center",
    fontWeight: "600",
    marginTop: -space.sm,
  },
  input: {
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
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    height: touch.buttonHeight,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  actionDanger: { backgroundColor: colors.dangerSoft },
  actionBtnText: { fontSize: font.body, fontWeight: "700", color: colors.text },
  actionCancel: {
    alignItems: "center",
    paddingVertical: space.xs,
  },
  actionCancelText: { fontSize: font.caption, color: colors.textMuted, fontWeight: "700" },
  sheetBtns: { flexDirection: "row", gap: space.md },
  cancelBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    height: touch.buttonHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: colors.textMuted, fontSize: font.body, fontWeight: "700" },
  okBtn: {
    flex: 2,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: touch.buttonHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  okText: { color: "#fff", fontSize: font.body, fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },
});
