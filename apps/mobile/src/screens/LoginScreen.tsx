import { useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { useKeyboardHeight } from "../utils/kb";
import {
  ActivityIndicator,
  ScrollView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useAuth } from "../auth-context";
import { BrandLockup } from "../components/BrandLockup";
import { colors, font, radius, touch } from "../theme/tokens";

type Mode = "login" | "register";

export function LoginScreen() {
  const { login, register } = useAuth();
  const { height: windowHeight } = useWindowDimensions();
  const topPad = Math.round(windowHeight * 0.12);
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

  const kbPad = useKeyboardHeight();
  const scrollRef = useRef<ScrollView>(null);
  // 键盘展开时滚到底：登录/注册按钮在短表单底部，仅加 paddingBottom 不会自动滚动
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      [60, 300].forEach((delay) =>
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), delay),
      );
    });
    return () => sub.remove();
  }, []);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={[styles.container, { paddingTop: topPad, paddingBottom: 24 + kbPad }]}
      keyboardShouldPersistTaps="handled"
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  container: {
    backgroundColor: colors.bg,
    justifyContent: "flex-start",
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 12,
  },
  hero: { alignItems: "center", marginBottom: 28 },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
    fontSize: font.body,
    color: colors.text,
    includeFontPadding: false,
    textAlignVertical: "center",
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
