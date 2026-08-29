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

/** 聚焦回调：立即补位 + 320ms 后（键盘展开动画结束）再校一次 */
export function makeReveal(
  scroller: { current: ScrollView | null },
  getScrollY: () => number,
  getInput: () => TextInput | null,
): () => void {
  const run = () => revealAboveKeyboard(scroller.current, getInput(), getScrollY());
  return () => {
    run();
    setTimeout(run, 320);
  };
}
