import { create } from "zustand";
import {
  addToCartQty,
  cartItemCount,
  cartTotalCents,
  removeFromCart,
  setLinePrice,
  setQuantity,
  type CartLine,
  type ScannedSku,
} from "@cloth-scan/shared";
import type { CachedSku } from "../../db/catalog";

/** 当前展示的 Sheet（同一时刻最多一个，避免扫码高频触发） */
export type Sheet =
  | "none"
  | "confirm" // 扫码确认卡
  | "manual" // 手动输入条码
  | "priceEdit" // 议价改价
  | "discount" // 整单优惠
  | "notFound"; // 未找到条码

export interface CashierState {
  /** 购物车行 */
  cart: CartLine[];
  /** 扫码确认卡中待确认的 SKU（未加入购物车） */
  pendingSku: CachedSku | null;
  /** 确认卡中待加入的数量 */
  pendingQty: number;
  /** 当前打开的 Sheet */
  activeSheet: Sheet;
  /** 未找到的条码（NotFound 展示用） */
  notFoundBarcode: string | null;
  /** 正在改价的购物车行 skuId */
  editingSkuId: string | null;
  /**
   * 整单优惠金额（分，≥0）。第 2 波 Task 4 改为订单级字段：
   * 各行 price 保持原价，优惠单独记录，结算时随 cartToSaleInput 提交。
   * 任意改车动作（加车/改量/删行/改价）都会重置为 0（原 applyCart 语义）。
   */
  orderDiscountCents: number;
  /** 顶部提示文案 */
  hint: string;

  // ---- actions ----
  /** 扫码/手动输入命中后：把 SKU 放入确认卡 */
  addPending: (sku: CachedSku) => void;
  /** 确认卡：加入购物车（调用 shared 的 addToCartQty 纯函数） */
  confirmAdd: () => void;
  /** 确认卡：调整待加入数量 */
  setPendingQty: (qty: number) => void;
  /** 改购物车某行数量（调用 shared 的 setQuantity 纯函数；清优惠） */
  setQty: (skuId: string, qty: number) => void;
  /** 删购物车行（清优惠） */
  removeLine: (skuId: string) => void;
  /** 改某行成交单价（调用 shared 的 setLinePrice 纯函数；清优惠） */
  editPrice: (skuId: string, priceCents: number) => void;
  /** 打开/切换/关闭 Sheet */
  setSheet: (s: Sheet) => void;
  /** 设置未找到条码并打开 NotFound */
  showNotFound: (barcode: string) => void;
  /** 打开改价 Sheet */
  startEditPrice: (skuId: string) => void;
  /**
   * 设置整单优惠（分）。传 0 即清除。
   * 由 DiscountSheet 计算：orderDiscountCents = max(0, 原价合计 - 目标总价)。
   */
  setOrderDiscount: (cents: number) => void;
  /** 设置顶部提示 */
  setHint: (h: string) => void;
  /** 关闭所有 Sheet（确认卡/NotFound），复位 pending */
  closeSheet: () => void;
  /** 结算成功后清空购物车 + 优惠 */
  resetAfterCheckout: () => void;
}

const DEFAULT_HINT = "对准吊牌二维码扫描";

export const useCashierStore = create<CashierState>((set, get) => ({
  cart: [],
  pendingSku: null,
  pendingQty: 1,
  activeSheet: "none",
  notFoundBarcode: null,
  editingSkuId: null,
  orderDiscountCents: 0,
  hint: DEFAULT_HINT,

  addPending: (sku) => set({ pendingSku: sku, pendingQty: 1, activeSheet: "confirm" }),

  confirmAdd: () => {
    const { pendingSku, pendingQty } = get();
    if (!pendingSku) return;
    const scanned: ScannedSku = {
      skuId: pendingSku.skuId,
      barcode: pendingSku.barcode,
      productName: pendingSku.productName,
      color: pendingSku.color,
      size: pendingSku.size,
      price: pendingSku.salePrice,
      stock: pendingSku.stock,
      image: pendingSku.coverImage ?? null,
    };
    // 加车动作 → 清除整单优惠（原 applyCart 语义）
    set({
      cart: addToCartQty(get().cart, scanned, pendingQty),
      orderDiscountCents: 0,
      pendingSku: null,
      pendingQty: 1,
      activeSheet: "none",
      hint: `已加入：${pendingSku.productName} ${pendingSku.color}/${pendingSku.size} ×${pendingQty}`,
    });
  },

  setPendingQty: (qty) => set({ pendingQty: qty }),

  setQty: (skuId, qty) =>
    set((s) => ({
      cart: setQuantity(s.cart, skuId, qty),
      orderDiscountCents: 0,
    })),

  removeLine: (skuId) =>
    set((s) => ({
      cart: removeFromCart(s.cart, skuId),
      orderDiscountCents: 0,
    })),

  editPrice: (skuId, priceCents) =>
    set((s) => ({
      cart: setLinePrice(s.cart, skuId, priceCents),
      orderDiscountCents: 0,
      editingSkuId: null,
      activeSheet: s.activeSheet === "priceEdit" ? "none" : s.activeSheet,
    })),

  setSheet: (sheet) => set({ activeSheet: sheet }),

  showNotFound: (barcode) => set({ notFoundBarcode: barcode, activeSheet: "notFound" }),

  startEditPrice: (skuId) => set({ editingSkuId: skuId, activeSheet: "priceEdit" }),

  setOrderDiscount: (cents) => set({ orderDiscountCents: Math.max(0, Math.round(cents)) }),

  setHint: (h) => set({ hint: h }),

  closeSheet: () =>
    set({
      pendingSku: null,
      notFoundBarcode: null,
      pendingQty: 1,
      activeSheet: "none",
    }),

  resetAfterCheckout: () =>
    set({
      cart: [],
      orderDiscountCents: 0,
      hint: DEFAULT_HINT,
    }),
}));

// ---- 选择器辅助（避免组件里重复 reduce） ----

/** 原价合计（分） */
export const selectTotalCents = (s: CashierState): number => cartTotalCents(s.cart);

/** 实收合计（分）= 原价 - 整单优惠，夹在 ≥0 */
export const selectFinalCents = (s: CashierState): number =>
  Math.max(0, cartTotalCents(s.cart) - s.orderDiscountCents);

/** 件数 */
export const selectCount = (s: CashierState): number => cartItemCount(s.cart);

/** 是否有整单优惠 */
export const selectDiscounted = (s: CashierState): boolean => s.orderDiscountCents > 0;
