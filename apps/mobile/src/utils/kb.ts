import { Keyboard, type ScrollView, type TextInput } from "react-native";

/**
 * Android 软键盘避让补位：窗口 resize 后 RN ScrollView 不会自动滚到焦点输入框，
 * 底部字段（如库存）会被键盘整行遮住。聚焦时测量输入框屏幕坐标，
 * 若底边低于键盘上沿则按超出量滚动（立即一次 + 键盘动画完成后重试一次）。
 * currentY 由调用方通过 onScroll 维护。
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
 * 聚焦回调：立即补位一次（模拟器/快机型够用）。
 * 真机上键盘展开动画 + 窗口 resize 完成时机不定，单靠这一下不可靠——
 * 请配合 useKeyboardReveal 使用。
 */
export function makeReveal(
  scroller: { current: ScrollView | null },
  getScrollY: () => number,
  getInput: () => TextInput | null,
): () => void {
  return () => revealAboveKeyboard(scroller.current, getInput(), getScrollY());
}

/**
 * 键盘事件驱动的补位（真机可靠路径）：
 * keyboardDidShow 在键盘完全展开、adjustResize 窗口收缩后才触发，
 * 此时 measureInWindow 拿到的是最终坐标；再做 0/250/550ms 三级重试，
 * 兜住慢动画机型（部分华为/荣耀输入法动画 >300ms）。
 * getInput 需返回「当前聚焦」的输入框：调用方在 onFocus 里记录活动字段。
 */
export function useKeyboardReveal(
  scroller: { current: ScrollView | null },
  getScrollY: () => number,
  getInput: () => TextInput | null,
): void {
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      const run = () => revealAboveKeyboard(scroller.current, getInput(), getScrollY());
      [0, 250, 550].forEach((delay) => setTimeout(run, delay));
    });
    // 引用由调用方以 ref 持有，挂载时监听一次即可
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
