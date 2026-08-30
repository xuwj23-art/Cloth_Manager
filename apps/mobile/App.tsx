import "./src/textDefaults";
import { Component, type ReactNode, useEffect } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Asset } from "expo-asset";
import { useFonts } from "expo-font";
import { createNavigationContainerRef, NavigationContainer } from "@react-navigation/native";
import { AuthProvider, useAuth } from "./src/auth-context";
import { DialogProvider } from "./src/dialog-context";
import { useOwnerSaleAlerts } from "./src/notify/saleAlerts";
import { SaleToastProvider } from "./src/notify/SaleToast";
import { SyncProvider } from "./src/sync/sync-context";
import { RootNavigator, type RootStackParamList } from "./src/navigation/RootNavigator";
import { LoginScreen } from "./src/screens/LoginScreen";
import { colors, font, radius, touch } from "./src/theme/tokens";

/** 全局导航 ref：让 Toast 卡片等 NavigationContainer 外的组件也能跳转 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** 老板机「新结账」提醒：轮询 + 前台 Toast 卡片 / 后台系统通知（设置页开关总闸） */
function SaleAlertsGate() {
  const { user } = useAuth();
  useOwnerSaleAlerts(user?.role === "owner", user?.id ?? null);
  return null;
}

function AuthedApp() {
  // React Navigation 接管全部切屏：屏幕映射为路由，参数经 route.params 传递，
  // 返回栈由 Stack 管理；SaleToastProvider 挂最外层，老板任何页面都能收到顶部提醒卡。
  return (
    <SaleToastProvider
      onTapOrder={() => {
        if (navigationRef.isReady() && navigationRef.getCurrentRoute()?.name !== "Sales") {
          navigationRef.navigate("Sales");
        }
      }}
    >
      <SaleAlertsGate />
      <NavigationContainer ref={navigationRef}>
        <RootNavigator />
      </NavigationContainer>
    </SaleToastProvider>
  );
}

function Root() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <SyncProvider enabled={!!user}>
      <AuthedApp />
    </SyncProvider>
  );
}

/**
 * 全局错误边界：渲染期一旦抛错，显示可读的错误文本而不是「全是空白」。
 * 这样真机/安装版出问题时能直接看到原因，便于排查。
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      const err = this.state.error;
      return (
        <View style={styles.errRoot}>
          <ScrollView contentContainerStyle={styles.errScroll}>
            <Text style={styles.errTitle}>应用启动出错</Text>
            <Text style={styles.errMsg}>{String(err?.message ?? err)}</Text>
            {!!err?.stack && <Text style={styles.errStack}>{err.stack}</Text>}
            <Pressable
              style={styles.retryBtn}
              accessibilityRole="button"
              accessibilityLabel="重新加载"
              onPress={() => this.setState({ error: null })}
            >
              <Text style={styles.retryText}>重新加载</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // 正式 APK 不会像 Expo Go 那样预装矢量字体；ionicons 必须与品牌字一样从
  // 工程 assets 加载，且 family 名必须是 `ionicons`（@expo/vector-icons 写死的）。
  const [fontsLoaded, fontError] = useFonts({
    ionicons: require("./assets/fonts/Ionicons.ttf"),
    NotoSerifSC: require("./assets/fonts/NotoSerifSC-Brand.ttf"),
  });

  useEffect(() => {
    void Asset.loadAsync([
      require("./assets/logo_mark.png"),
      require("./assets/logo_lockup.png"),
    ]).catch(() => {
      /* 启动不阻断，Image 仍会再试一次 */
    });
  }, []);

  if (!fontsLoaded && !fontError) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <DialogProvider>
            <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
              <StatusBar style="auto" />
              <Root />
            </SafeAreaView>
          </DialogProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errRoot: { flex: 1, backgroundColor: "#fff", paddingTop: 60 },
  errScroll: { padding: 20 },
  errTitle: { fontSize: 18, fontWeight: "700", color: "#c00", marginBottom: 12 },
  errMsg: { fontSize: 15, color: "#222", marginBottom: 16 },
  errStack: { fontSize: 12, color: "#666", fontFamily: "monospace" },
  // 重新加载按钮（设计语言 §3：墨绿品牌色、≥48dp、字号 16sp）
  retryBtn: {
    marginTop: 20,
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: { color: "#fff", fontSize: font.body, fontWeight: "800" },
});
