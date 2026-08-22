import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ShopMember } from "@cloth-scan/shared";
import { apiCreateStaff, apiDeleteStaff, apiListStaff, apiResetStaffPassword } from "../api";
import { BackButton } from "../components/BackButton";
import { useDialog } from "../dialog-context";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius } from "../theme/tokens";

type StaffNav = NativeStackNavigationProp<RootStackParamList, "Staff">;

function formatDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function StaffScreen() {
  const navigation = useNavigation<StaffNav>();
  const [members, setMembers] = useState<ShopMember[]>([]);
  const [loading, setLoading] = useState(true);
  const { confirm, notice } = useDialog();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 重置店员密码弹层（Android 无 Alert.prompt，用 Modal + 输入框）
  const [resetTarget, setResetTarget] = useState<ShopMember | null>(null);
  const [resetPwd, setResetPwd] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

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

  const submit = async () => {
    if (!name.trim() || !phone.trim() || password.length < 6) {
      await notice("请填写完整");
      return;
    }
    setSubmitting(true);
    try {
      await apiCreateStaff({
        name: name.trim(),
        phone: phone.trim(),
        password,
      });
      setName("");
      setPhone("");
      setPassword("");
      await notice("已添加");
      await load();
    } catch (e) {
      await notice("添加失败", (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async (member: ShopMember) => {
    const ok = await confirm({
      title: "删除店员",
      message: `确定删除「${member.name}」？`,
      confirmLabel: "删除",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiDeleteStaff(member.id);
      await load();
    } catch (e) {
      await notice("删除失败", (e as Error).message);
    }
  };

  const submitReset = async () => {
    if (!resetTarget) return;
    if (resetPwd.length < 6) {
      setResetError("密码至少 6 位");
      return;
    }
    setResetting(true);
    try {
      await apiResetStaffPassword(resetTarget.id, resetPwd);
      setResetTarget(null);
      setResetPwd("");
      await notice("密码已修改");
    } catch (e) {
      await notice("修改失败", (e as Error).message);
    } finally {
      setResetting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>店员管理</Text>
        <View style={styles.placeholder} />
      </View>

      <FlatList
        data={members}
        keyExtractor={(m) => m.id}
        onRefresh={load}
        refreshing={loading}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.form}>
            <Text style={styles.formTitle}>新增店员</Text>
            <TextInput
              style={styles.input}
              placeholder="姓名"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={styles.input}
              placeholder="手机号"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <TextInput
              style={styles.input}
              placeholder="初始密码"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <Pressable
              style={[styles.addBtn, submitting && styles.addBtnDisabled]}
              onPress={() => void submit()}
              disabled={submitting}
            >
              <Text style={styles.addText}>{submitting ? "添加中…" : "添加店员"}</Text>
            </Pressable>
            <Text style={styles.sectionTitle}>门店成员</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 24 }} />
          ) : (
            <Text style={styles.empty}>还没有成员</Text>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.memberRow}>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName} numberOfLines={1}>
                {item.name}
                <Text style={item.role === "owner" ? styles.ownerTag : styles.staffTag}>
                  {"  "}
                  {item.role === "owner" ? "店主" : "店员"}
                </Text>
              </Text>
              <Text style={styles.memberMeta} numberOfLines={2}>
                {item.phone} · 加入 {formatDate(item.createdAt)}
              </Text>
            </View>
            <View style={styles.rowBtns}>
              {item.role === "owner" ? (
                <Pressable
                  style={styles.resetBtn}
                  onPress={() => navigation.navigate("ChangePassword")}
                  hitSlop={8}
                >
                  <Text style={styles.resetText}>修改密码</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    style={styles.resetBtn}
                    onPress={() => {
                      setResetTarget(item);
                      setResetPwd("");
                      setResetError(null);
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.resetText}>修改密码</Text>
                  </Pressable>
                  <Pressable
                    style={styles.deleteBtn}
                    onPress={() => void confirmDelete(item)}
                    hitSlop={8}
                  >
                    <Text style={styles.deleteText}>删除</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        )}
      />

      {/* 重置店员密码弹层 */}
      <Modal
        visible={resetTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setResetTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>修改密码</Text>
            <Text style={styles.modalMeta}>{resetTarget?.name}</Text>
            <TextInput
              style={styles.input}
              placeholder="新密码"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={resetPwd}
              onChangeText={(t) => {
                setResetError(null);
                setResetPwd(t);
              }}
            />
            {resetError ? <Text style={styles.error}>{resetError}</Text> : null}
            <View style={styles.modalBtns}>
              <Pressable
                style={styles.modalCancel}
                onPress={() => {
                  setResetTarget(null);
                  setResetError(null);
                }}
                disabled={resetting}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.modalOk, resetting && styles.addBtnDisabled]}
                onPress={() => void submitReset()}
                disabled={resetting}
              >
                <Text style={styles.addText}>{resetting ? "保存中…" : "确定"}</Text>
              </Pressable>
            </View>
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
  title: { fontSize: 18, fontWeight: "800", color: "#111" },
  placeholder: { width: 32 },
  list: { padding: 16, gap: 10 },
  form: { gap: 10, marginBottom: 4 },
  formTitle: { fontSize: 16, fontWeight: "700", color: "#111" },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 48,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.card,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  addBtn: {
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  addBtnDisabled: { opacity: 0.6 },
  addText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#374151",
    marginTop: 12,
  },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 24 },
  error: { color: "#dc2626" },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  memberInfo: { flex: 1, minWidth: 0, gap: 3, paddingRight: 8 },
  rowBtns: { flexDirection: "row", alignItems: "center", gap: 6 },
  resetBtn: {
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  resetText: { color: "#2563eb", fontSize: 13, fontWeight: "700" },
  deleteBtn: {
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 4,
  },
  deleteText: { color: "#dc2626", fontSize: 13, fontWeight: "700" },
  memberName: { fontSize: 16, fontWeight: "700", color: "#111" },
  memberMeta: { fontSize: 13, color: "#6b7280" },
  ownerTag: { fontSize: 12, color: "#d97706", fontWeight: "700" },
  staffTag: { fontSize: 12, color: "#2563eb", fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  modalCard: {
    width: "100%",
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: 22,
    gap: 12,
  },
  modalTitle: { fontSize: font.title, fontWeight: "800", color: colors.text, textAlign: "center" },
  modalMeta: { fontSize: font.body, color: colors.textMuted, textAlign: "center" },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 2 },
  modalCancel: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalCancelText: { color: "#6b7280", fontSize: 15, fontWeight: "700" },
  modalOk: {
    flex: 1,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
});
