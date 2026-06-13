import { Component, useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  BackHandler,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "./src/auth-context";
import { useOwnerSaleAlerts } from "./src/notify/saleAlerts";
import { SyncProvider } from "./src/sync/sync-context";
import { HomeScreen } from "./src/screens/HomeScreen";
import { CashierScreen } from "./src/screens/CashierScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { CreateProductScreen } from "./src/screens/CreateProductScreen";
import { ProductsScreen } from "./src/screens/ProductsScreen";
import { EditProductScreen } from "./src/screens/EditProductScreen";
import { LabelPrintScreen } from "./src/screens/LabelPrintScreen";
import {
  SalesScreen,
  type SalesMonth,
  type SalesTab,
} from "./src/screens/SalesScreen";
import { SaleDetailScreen } from "./src/screens/SaleDetailScreen";
import { StaffScreen } from "./src/screens/StaffScreen";
import type { ProductWithSkus } from "@cloth-scan/shared";

type Screen =
  | "home"
  | "scan"
  | "products"
  | "create"
  | "sales"
  | "saleDetail"
  | "staff"
  | "editProduct"
  | "labelPrint";

function AuthedApp() {
  const { user } = useAuth();
  const [screen, setScreen] = useState<Screen>("home");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProductWithSkus | null>(null);
  const [labelProduct, setLabelProduct] = useState<ProductWithSkus | null>(null);
  // 销售记录的内部导航状态（提升到此处，进出单据详情时不丢失层级）
  const [salesTab, setSalesTab] = useState<SalesTab>("today");
  const [salesMonth, setSalesMonth] = useState<SalesMonth>(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [salesDay, setSalesDay] = useState<string | null>(null);

  // 老板：新结账弹窗 + 铃声 + 通知栏提醒
  useOwnerSaleAlerts(user?.role === "owner", user?.id ?? null);

  // 系统返回键 / 手势返回：在 App 内逐级返回，而不是直接退出
  useEffect(() => {
    const onBack = () => {
      switch (screen) {
        case "home":
          return false; // 已在首页，交给系统（退出/回桌面）
        case "editProduct":
          setScreen("products");
          return true;
        case "labelPrint":
          setScreen(editing ? "editProduct" : "products");
          return true;
        case "saleDetail":
          setScreen("sales");
          return true;
        case "sales":
          // 历史→当日明细：先逐级返回到月列表，再回首页
          if (salesDay !== null) {
            setSalesDay(null);
            return true;
          }
          setScreen("home");
          return true;
        case "create":
          setScreen("products");
          return true;
        default:
          // scan / products / staff → 回首页
          setScreen("home");
          return true;
      }
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => sub.remove();
  }, [screen, editing, salesDay]);

  switch (screen) {
    case "scan":
      return <CashierScreen onBack={() => setScreen("home")} />;
    case "products":
      return (
        <ProductsScreen
          onBack={() => setScreen("home")}
          onCreate={() => setScreen("create")}
          onEdit={(p) => {
            setEditing(p);
            setScreen("editProduct");
          }}
        />
      );
    case "editProduct":
      return editing ? (
        <EditProductScreen
          product={editing}
          onDone={() => {
            setEditing(null);
            setScreen("products");
          }}
          onPrintLabels={(p) => {
            setLabelProduct(p);
            setScreen("labelPrint");
          }}
        />
      ) : (
        <ProductsScreen
          onBack={() => setScreen("home")}
          onCreate={() => setScreen("create")}
          onEdit={(p) => {
            setEditing(p);
            setScreen("editProduct");
          }}
        />
      );
    case "labelPrint":
      return labelProduct ? (
        <LabelPrintScreen
          product={labelProduct}
          onBack={() => setScreen(editing ? "editProduct" : "products")}
        />
      ) : (
        <ProductsScreen
          onBack={() => setScreen("home")}
          onCreate={() => setScreen("create")}
          onEdit={(p) => {
            setEditing(p);
            setScreen("editProduct");
          }}
        />
      );
    case "create":
      return <CreateProductScreen onDone={() => setScreen("products")} />;
    case "staff":
      return <StaffScreen onBack={() => setScreen("home")} />;
    case "sales":
      return (
        <SalesScreen
          tab={salesTab}
          onTab={setSalesTab}
          month={salesMonth}
          onMonth={setSalesMonth}
          day={salesDay}
          onDay={setSalesDay}
          onBack={() => setScreen("home")}
          onOpenOrder={(id) => {
            setOrderId(id);
            setScreen("saleDetail");
          }}
        />
      );
    case "saleDetail":
      return orderId ? (
        <SaleDetailScreen
          orderId={orderId}
          onBack={() => setScreen("sales")}
        />
      ) : (
        <SalesScreen
          tab={salesTab}
          onTab={setSalesTab}
          month={salesMonth}
          onMonth={setSalesMonth}
          day={salesDay}
          onDay={setSalesDay}
          onBack={() => setScreen("home")}
          onOpenOrder={(id) => {
            setOrderId(id);
            setScreen("saleDetail");
          }}
        />
      );
    default:
      return (
        <HomeScreen
          onScan={() => setScreen("scan")}
          onProducts={() => setScreen("products")}
          onCreate={() => setScreen("create")}
          onSales={() => {
            setSalesTab("today");
            setSalesDay(null);
            setScreen("sales");
          }}
          onStaff={() => setScreen("staff")}
        />
      );
  }
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
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
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
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
            <StatusBar style="auto" />
            <Root />
          </SafeAreaView>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errRoot: { flex: 1, backgroundColor: "#fff", paddingTop: 60 },
  errScroll: { padding: 20 },
  errTitle: { fontSize: 18, fontWeight: "700", color: "#c00", marginBottom: 12 },
  errMsg: { fontSize: 15, color: "#222", marginBottom: 16 },
  errStack: { fontSize: 12, color: "#666", fontFamily: "monospace" },
});
