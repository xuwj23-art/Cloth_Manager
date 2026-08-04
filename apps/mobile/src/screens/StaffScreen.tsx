import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ShopMember } from "@cloth-scan/shared";
import { apiCreateStaff, apiDeleteStaff, apiListStaff } from "../api";
import type { RootStackParamList } from "../navigation/RootNavigator";

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
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
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
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={styles.input}
              placeholder="手机号（登录账号）"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <TextInput
              style={styles.input}
              placeholder="初始密码（至少 6 位）"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <Pressable
              style={[styles.addBtn, submitting && styles.addBtnDisabled]}
              onPress={submit}
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
              <Text style={styles.memberName}>
                {item.name}
                <Text style={item.role === "owner" ? styles.ownerTag : styles.staffTag}>
                  {"  "}
                  {item.role === "owner" ? "店主" : "店员"}
                </Text>
              </Text>
              <Text style={styles.memberMeta}>
                {item.phone} · 加入 {formatDate(item.createdAt)}
              </Text>
            </View>
            {item.role !== "owner" ? (
              <Pressable style={styles.deleteBtn} onPress={() => confirmDelete(item)} hitSlop={8}>
                <Text style={styles.deleteText}>删除</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      />
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
  placeholder: { width: 32 },
  list: { padding: 16, gap: 10 },
  form: { gap: 10, marginBottom: 4 },
  formTitle: { fontSize: 16, fontWeight: "700", color: "#111" },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
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
  memberInfo: { flex: 1, gap: 3 },
  deleteBtn: {
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 8,
  },
  deleteText: { color: "#dc2626", fontSize: 13, fontWeight: "700" },
  memberName: { fontSize: 16, fontWeight: "700", color: "#111" },
  memberMeta: { fontSize: 13, color: "#6b7280" },
  ownerTag: { fontSize: 12, color: "#d97706", fontWeight: "700" },
  staffTag: { fontSize: 12, color: "#2563eb", fontWeight: "700" },
});
