import { requireOptionalNativeModule } from "expo";

/**
 * 驰腾(CTPL)蓝牙打印原生模块。
 * 仅在「开发版/正式版 APK」中可用；在 Expo Go 中返回 null（上层需做降级处理）。
 */
export default requireOptionalNativeModule("CtPrinter");
