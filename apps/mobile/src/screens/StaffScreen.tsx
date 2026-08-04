import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ShopMember } from "@cloth-scan/shared";
import { apiCreateStaff, apiDeleteStaff, apiListStaff } from "../api";
import { StateView } from "../components/StateView";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space, touch } from "../theme/tokens";

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
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      Alert.alert("请填写完整", "姓名、手机号必填，密码至少 6 位");
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
      Alert.alert("已添加", "店员账号创建成功");
      await load();
    } catch (e) {
      Alert.alert("添加失败", (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = (member: ShopMember) => {
    Alert.alert(
      "删除店员",
      `确认删除店员「${member.name}」？\n删除后该账号无法登录，已产生的销售记录会保留（收银员显示为空）。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: async () => {
            try {
              await apiDeleteStaff(member.id);
              await load();
            } catch (e) {
              Alert.alert("删除失败", (e as Error).message);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.topbarBtn}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>店员管理</Text>
        <View style={styles.placeholder} />
      </View>

      <StateView
        loading={loading && members.length === 0}
        error={error}
        onRetry={load}
        empty={!loading && !error && members.length === 0}
        emptyText="还没有成员，在上方添加第一位店员"
      >
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
                placeholder="手机号（登录账号）"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
              <TextInput
                style={styles.input}
                placeholder="初始密码（至少 6 位）"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.addBtn,
                  submitting && styles.addBtnDisabled,
                  pressed && !submitting && styles.addBtnPressed,
                ]}
                onPress={submit}
                disabled={submitting}
              >
                <Text style={styles.addText}>{submitting ? "添加中…" : "添加店员"}</Text>
              </Pressable>
              <Text style={styles.sectionTitle}>门店成员</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.memberRow}>
              <View style={styles.memberInfo}>
                <View style={styles.nameRow}>
                  <Text style={styles.memberName}>{item.name}</Text>
                  <View
                    style={[
                      styles.roleBadge,
                      item.role === "owner" ? styles.ownerBadge : styles.staffBadge,
                    ]}
                  >
                    <Text
                      style={[
                        styles.roleText,
                        item.role === "owner" ? styles.ownerText : styles.staffText,
                      ]}
                    >
                      {item.role === "owner" ? "店主" : "店员"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.memberMeta}>
                  {item.phone} · 加入 {formatDate(item.createdAt)}
                </Text>
              </View>
              {item.role !== "owner" ? (
                <Pressable
                  style={({ pressed }) => [styles.deleteBtn, pressed && styles.deletePressed]}
                  onPress={() => confirmDelete(item)}
                  hitSlop={8}
                >
                  <Text style={styles.deleteText}>删除</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        />
      </StateView>
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
  placeholder: { width: 32 },
  list: { padding: space.lg, gap: space.md },
  form: { gap: space.md, marginBottom: space.xs },
  formTitle: { fontSize: font.body, fontWeight: "700", color: colors.text },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: touch.buttonHeight,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.card,
  },
  addBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    minHeight: touch.buttonHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnPressed: { backgroundColor: colors.primaryPressed },
  addBtnDisabled: { opacity: 0.6 },
  addText: { color: "#fff", fontSize: font.body, fontWeight: "800" },
  sectionTitle: {
    fontSize: font.body,
    fontWeight: "700",
    color: colors.text,
    marginTop: space.md,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  memberInfo: { flex: 1, gap: space.xs },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  memberName: { fontSize: font.body, fontWeight: "700", color: colors.text },
  // 角色徽标（清晰填充态）
  roleBadge: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  ownerBadge: { backgroundColor: "#FEF3C7" },
  staffBadge: { backgroundColor: colors.primarySoft },
  roleText: { fontSize: font.caption - 1, fontWeight: "700" },
  ownerText: { color: "#B45309" },
  staffText: { color: colors.primary },
  memberMeta: { fontSize: font.caption, color: colors.textMuted },
  deleteBtn: {
    borderWidth: 1.5,
    borderColor: "#FECACA",
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    minHeight: touch.minSize,
    justifyContent: "center",
    marginLeft: space.sm,
  },
  deletePressed: { opacity: 0.7 },
  deleteText: { color: colors.danger, fontSize: font.caption, fontWeight: "700" },
});
