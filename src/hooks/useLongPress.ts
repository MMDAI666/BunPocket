import { useCallback, useRef } from "react";
import type { MouseEvent, PointerEvent } from "react";

interface LongPressOptions {
  /** 触发阈值（ms），默认 460 */
  delay?: number;
  onLongPress: () => void;
}

/**
 * 长按手势：按下计时，位移超过 10px / 抬手 / 指针取消即取消。
 * 触发后会吞掉紧随其后的 click，避免"长按删除"又选中了该标签。
 * 鼠标左键同样可用（桌面端）。
 */
export function useLongPress({ delay = 460, onLongPress }: LongPressOptions) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      fired.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress();
      }, delay);
    },
    [cancel, delay, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const start = origin.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
        cancel();
        origin.current = null;
      }
    },
    [cancel],
  );

  const onPointerEnd = useCallback(() => {
    cancel();
    origin.current = null;
  }, [cancel]);

  const onClickCapture = useCallback((event: MouseEvent) => {
    if (fired.current) {
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  return {
    longPressProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerLeave: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onClickCapture,
      // 移动端 WebView 长按会弹系统菜单/选择文字，统一关掉
      onContextMenu: (event: MouseEvent) => event.preventDefault(),
    },
  };
}
