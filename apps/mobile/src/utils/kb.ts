import { Keyboard, TextInput } from "react-native";
import type { ScrollView } from "react-native";

/**
 * Android 软键盘避让补位：RN ScrollView 不会自动滚到焦点输入框，
 * 底部字段（如库存）会被键盘整行遮住。测量输入框屏幕坐标，
 * 若底边低于键盘上沿则按超出量滚动。currentY 由调用方通过 onScroll 维护。
 */
export function revealAboveKeyboard(
  scroller: ScrollView | null,
  input: TextInput | null,
  currentY: number,
  margin = 70,
): void {
  if (!scroller || !input) return;
  input.measureInWindow((_x, y, _w, h) => {
    if (y == null || h == null) return;
    const m = Keyboard.metrics();
    const kbTop = m ? m.screenY : Number.POSITIVE_INFINITY;
    const overshoot = y + h - (kbTop - margin);
    if (overshoot > 0) {
      scroller.scrollTo({ y: Math.max(0, currentY + overshoot), animated: true });
    }
  });
}

import { useEffect, useState } from "react";

/**
 * 表单键盘避让（全量、免接线）。
 *
 * keyboardDidShow 后用 TextInput.State.currentlyFocusedInput() 直接拿到
 * 「此刻真正聚焦」的输入框——不依赖任何 onFocus 手工登记，天然覆盖
 * 品名/材质/品类/价格/库存等全部字段，也杜绝「点了 A 字段却按 B 字段
 * （上次残留的活动字段）计算、整页被强制滚到底」的陈旧目标问题。
 * 0/250/550ms 三级重试兜住慢机型键盘动画（部分华为/荣耀 >300ms）。
 *
 * 前提：字段所在 ScrollView 的 contentContainerStyle 加了
 * useKeyboardHeight() 的 paddingBottom——末尾字段在滚动尽头，
 * 没有余量 scrollTo 无从滚动（真机「避让无效」的第一根因）。
 */
export function useKeyboardReveal(
  scroller: { current: ScrollView | null },
  getScrollY: () => number,
): void {
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      const run = () => {
        const focused = TextInput.State.currentlyFocusedInput() as TextInput | null;
        revealAboveKeyboard(scroller.current, focused, getScrollY());
      };
      [0, 250, 550].forEach((delay) => setTimeout(run, delay));
    });
    return () => sub.remove();
  }, []);
}

/**
 * 键盘高度（dp，收起为 0）。
 * 关键用途：加到表单 ScrollView 的 contentContainerStyle.paddingBottom 上——
 * 底部字段（库存等）常位于内容末尾，ScrollView 已到最大偏移时 scrollTo 根本无余量可滚
 * （真机「键盘避让无效」的根因）。补位后滚动链路才真正生效。
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
