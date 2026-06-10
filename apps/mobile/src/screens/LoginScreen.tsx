import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "../auth-context";

type Mode = "login" | "register";

export function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [shopName, setShopName] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "login") {
        await login({ phone, password });
      } else {
        await register({ shopName, name, phone, password, inviteCode });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.title}>服装进销存</Text>
      <Text style={styles.subtitle}>
        {mode === "login" ? "登录你的门店账号" : "注册并开通新门店"}
      </Text>

      {mode === "register" && (
        <>
          <TextInput
            style={styles.input}
            placeholder="店铺名称"
            value={shopName}
            onChangeText={setShopName}
          />
          <TextInput
            style={styles.input}
            placeholder="你的姓名"
            value={name}
            onChangeText={setName}
          />
        </>
      )}

      <TextInput
        style={styles.input}
        placeholder="手机号"
        keyboardType="phone-pad"
        autoCapitalize="none"
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput
        style={styles.input}
        placeholder="密码"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {mode === "register" && (
        <>
          <TextInput
            style={styles.input}
            placeholder="注册邀请码"
            autoCapitalize="none"
            value={inviteCode}
            onChangeText={setInviteCode}
          />
          <Text style={styles.inviteHint}>
            注册需邀请码，请向管理员获取。
          </Text>
        </>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.btn, submitting && styles.btnDisabled]}
        disabled={submitting}
        onPress={submit}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>
            {mode === "login" ? "登录" : "注册"}
          </Text>
        )}
      </Pressable>

      <Pressable
        style={styles.switchBtn}
        onPress={() => {
          setError(null);
          setMode(mode === "login" ? "register" : "login");
        }}
      >
        <Text style={styles.switchText}>
          {mode === "login" ? "没有账号？去注册门店" : "已有账号？去登录"}
        </Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: { fontSize: 30, fontWeight: "800", color: "#111", textAlign: "center" },
  subtitle: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  btn: {
    backgroundColor: "#2563eb",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  switchBtn: { alignItems: "center", paddingVertical: 12 },
  switchText: { color: "#2563eb", fontSize: 15 },
  inviteHint: { color: "#9ca3af", fontSize: 12, marginTop: -6 },
  error: { color: "#dc2626", textAlign: "center" },
});
