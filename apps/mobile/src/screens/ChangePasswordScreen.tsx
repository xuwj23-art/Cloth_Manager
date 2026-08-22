import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { apiChangePassword } from "../api";
import { useAuth } from "../auth-context";
import { BackButton } from "../components/BackButton";
import { useDialog } from "../dialog-context";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, space, touch } from "../theme/tokens";

type Nav = NativeStackNavigationProp<RootStackParamList, "ChangePassword">;

export function ChangePasswordScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const { notice } = useDialog();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user?.role !== "owner") navigation.goBack();
  }, [user, navigation]);

  const submit = async () => {
    if (!oldPassword || !newPassword) {
      await notice("请填写完整");
      return;
    }
    if (newPassword.length < 6) {
      await notice("新密码至少 6 位");
      return;
    }
    if (newPassword !== confirm) {
      await notice("两次密码不一致");
      return;
    }
    if (newPassword === oldPassword) {
      await notice("新密码不能与原密码相同");
      return;
    }
    setSubmitting(true);
    try {
      await apiChangePassword({ oldPassword, newPassword });
      await notice("修改成功");
      navigation.goBack();
    } catch (e) {
      await notice("修改失败", (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>修改密码</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="原密码"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={oldPassword}
          onChangeText={setOldPassword}
        />
        <TextInput
          style={styles.input}
          placeholder="新密码"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={newPassword}
          onChangeText={setNewPassword}
        />
        <TextInput
          style={styles.input}
          placeholder="确认新密码"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
        />
        <Pressable
          style={[styles.btn, submitting && styles.btnDisabled]}
          onPress={() => void submit()}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>确认修改</Text>
          )}
        </Pressable>
      </View>
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
    paddingVertical: 14,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  back: { color: colors.primary, fontSize: font.body, fontWeight: "600" },
  title: { fontSize: font.title, fontWeight: "800", color: colors.text },
  placeholder: { width: 32 },
  form: { padding: 20, gap: 12 },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: font.body,
    color: colors.text,
  },
  btn: {
    backgroundColor: colors.primary,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: font.body, fontWeight: "700" },
});
