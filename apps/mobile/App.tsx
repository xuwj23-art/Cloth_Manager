import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "./src/auth-context";
import { SyncProvider } from "./src/sync/sync-context";
import { HomeScreen } from "./src/screens/HomeScreen";
import { CashierScreen } from "./src/screens/CashierScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { CreateProductScreen } from "./src/screens/CreateProductScreen";
import { ProductsScreen } from "./src/screens/ProductsScreen";
import { EditProductScreen } from "./src/screens/EditProductScreen";
import { LabelPrintScreen } from "./src/screens/LabelPrintScreen";
import { SalesScreen } from "./src/screens/SalesScreen";
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
  const [screen, setScreen] = useState<Screen>("home");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProductWithSkus | null>(null);
  const [labelProduct, setLabelProduct] = useState<ProductWithSkus | null>(null);

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
          onSales={() => setScreen("sales")}
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

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
          <StatusBar style="auto" />
          <Root />
        </SafeAreaView>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
