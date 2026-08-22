import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { apiChangePassword } from "../api";
import type { RootStackParamList } from "../navigation/RootNavigator";

type Nav = NativeStackNavigationProp<RootStackParamList, "ChangePassword">;

/**
 * 修改自己的密码（店主/店员均可）。
 * 需原密码——防手机被拿到后直接改密。改密后当前登录态保持（JWT 无撤销），
 * 但新设备无法再用旧密码登录。
 */
export function ChangePasswordScreen() {
  const navigation = useNavigation<Nav>();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!oldPassword || !newPassword) {
      Alert.alert("请填写完整", "原密码与新密码均不能为空");
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert("密码太短", "新密码至少 6 位");
      return;
    }
    if (newPassword !== confirm) {
      Alert.alert("两次输入不一致", "请重新输入确认新密码");
      return;
    }
    if (newPassword === oldPassword) {
      Alert.alert("密码未变化", "新密码不能与原密码相同");
      return;
    }
    setSubmitting(true);
    try {
      await apiChangePassword({ oldPassword, newPassword });
      Alert.alert("修改成功", "请牢记新密码，下次登录使用新密码", [
        { text: "好的", onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert("修改失败", (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>修改密码</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="原密码"
          secureTextEntry
          value={oldPassword}
          onChangeText={setOldPassword}
        />
        <TextInput
          style={styles.input}
          placeholder="新密码（至少 6 位）"
          secureTextEntry
          value={newPassword}
          onChangeText={setNewPassword}
        />
        <TextInput
          style={styles.input}
          placeholder="确认新密码"
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
        />
        <Pressable
          style={[styles.btn, submitting && styles.btnDisabled]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>确认修改</Text>
          )}
        </Pressable>
        <Text style={styles.hint}>
          修改后当前手机保持登录；其他设备需用新密码登录。忘记密码请联系店主（店主忘记需在服务器重置）。
        </Text>
      </View>
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
  form: { padding: 20, gap: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  btn: {
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  hint: { fontSize: 13, color: "#9ca3af", lineHeight: 18, marginTop: 2 },
});
