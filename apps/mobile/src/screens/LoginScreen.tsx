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
import { BrandLockup } from "../components/BrandLockup";
import { colors, font, radius, touch } from "../theme/tokens";

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
      <View style={styles.hero}>
        <BrandLockup variant="login" />
      </View>

      {mode === "register" && (
        <>
          <TextInput
            style={styles.input}
            placeholder="店铺名称"
            placeholderTextColor={colors.textMuted}
            value={shopName}
            onChangeText={setShopName}
          />
          <TextInput
            style={styles.input}
            placeholder="姓名"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
          />
        </>
      )}

      <TextInput
        style={styles.input}
        placeholder="手机号"
        placeholderTextColor={colors.textMuted}
        keyboardType="phone-pad"
        autoCapitalize="none"
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput
        style={styles.input}
        placeholder="密码"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {mode === "register" && (
        <TextInput
          style={styles.input}
          placeholder="邀请码"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          value={inviteCode}
          onChangeText={setInviteCode}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.btn, submitting && styles.btnDisabled]}
        disabled={submitting}
        onPress={() => void submit()}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>{mode === "login" ? "登录" : "注册"}</Text>
        )}
      </Pressable>

      <Pressable
        style={styles.switchBtn}
        onPress={() => {
          setError(null);
          setMode(mode === "login" ? "register" : "login");
        }}
      >
        <Text style={styles.switchText}>{mode === "login" ? "注册门店" : "返回登录"}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  hero: { alignItems: "center", marginBottom: 20 },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: font.body,
    color: colors.text,
  },
  btn: {
    backgroundColor: colors.primary,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: font.title, fontWeight: "600" },
  switchBtn: { alignItems: "center", paddingVertical: 12 },
  switchText: { color: colors.primary, fontSize: font.body, fontWeight: "600" },
  error: { color: colors.danger, textAlign: "center", fontSize: font.body },
});
