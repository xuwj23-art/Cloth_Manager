import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { ProductWithSkus } from "@cloth-scan/shared";
import { CashierScreen } from "../screens/CashierScreen";
import { ChangePasswordScreen } from "../screens/ChangePasswordScreen";
import { CreateProductScreen } from "../screens/CreateProductScreen";
import { EditProductScreen } from "../screens/EditProductScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { LabelPrintScreen } from "../screens/LabelPrintScreen";
import { ProductsScreen } from "../screens/ProductsScreen";
import { SaleDetailScreen } from "../screens/SaleDetailScreen";
import { SalesScreen } from "../screens/SalesScreen";
import { StaffScreen } from "../screens/StaffScreen";
import { SyncErrorsScreen } from "../screens/SyncErrorsScreen";

/**
 * 根 Stack 路由参数表。
 * - EditProduct / LabelPrint 直接传完整的 ProductWithSkus 对象：原实现即持有该
 *   对象，避免再发一次请求；该对象是纯数据，可作为导航参数。
 */
export type RootStackParamList = {
  Home: undefined;
  Cashier: undefined;
  ChangePassword: undefined;
  Products: { scope?: "active" | "archived" } | undefined;
  CreateProduct: undefined;
  EditProduct: { product: ProductWithSkus };
  Sales: undefined;
  SaleDetail: { orderId: string };
  Staff: undefined;
  LabelPrint: { product: ProductWithSkus };
  SyncErrors: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * 设计语言 §3.1/3.2：浅灰底、标题 18sp。
 * 各屏均保留自带的 rich topbar（含在线状态/+建档/编辑等动作按钮），故默认隐藏
 * Stack 自带 header；headerStyle 仍按设计语言配置，供未来切回原生 header 时复用。
 */
const screenOptions = {
  headerShown: false,
  headerStyle: {
    backgroundColor: "#F5F5F7",
  },
  headerTitleStyle: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: "#1A1A1A",
  },
  headerTintColor: "#2563eb",
  headerBackTitleVisible: false,
};

export function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: "首页" }} />
      <Stack.Screen name="Cashier" component={CashierScreen} options={{ title: "扫码收银" }} />
      <Stack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
        options={{ title: "修改密码" }}
      />
      <Stack.Screen name="Products" component={ProductsScreen} options={{ title: "商品列表" }} />
      <Stack.Screen
        name="CreateProduct"
        component={CreateProductScreen}
        options={{ title: "商品建档" }}
      />
      <Stack.Screen
        name="EditProduct"
        component={EditProductScreen}
        options={{ title: "编辑商品" }}
      />
      <Stack.Screen
        name="LabelPrint"
        component={LabelPrintScreen}
        options={{ title: "打印吊牌" }}
      />
      <Stack.Screen name="Sales" component={SalesScreen} options={{ title: "销售记录" }} />
      <Stack.Screen
        name="SaleDetail"
        component={SaleDetailScreen}
        options={{ title: "单据详情" }}
      />
      <Stack.Screen name="Staff" component={StaffScreen} options={{ title: "店员管理" }} />
      <Stack.Screen
        name="SyncErrors"
        component={SyncErrorsScreen}
        options={{ title: "同步失败" }}
      />
    </Stack.Navigator>
  );
}
