import { useCallback } from "react";
import {
  useNavigate,
  type NavigateOptions,
  type To,
} from "react-router-dom";

/** Android WebView / 桌面 WebView2 支持情况在运行时判断；不支持时走 CSS 进场动画 */
export const supportsViewTransitions =
  typeof document !== "undefined" &&
  "startViewTransition" in document;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function setDirection(direction: "forward" | "back") {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.navDir = direction;
  }
}

export type AppTo = To | number;

/**
 * 统一导航入口：
 * - 前进/返回设置 data-nav-dir，供 View Transition CSS 与 CSS fallback 使用
 * - 支持时启用 React Router 的 viewTransition（需配合 data router）
 * - reduce motion 时不启用原生过渡
 *
 * 注意：number 形式（navigate(-1)）的 POP 过渡由 data router 的 appliedViewTransitions
 * 自动处理，方向已经在调用前写入 data-nav-dir。
 */
export function useAppNavigate() {
  const navigate = useNavigate();

  return useCallback(
    (to: AppTo, opts?: NavigateOptions) => {
      const direction =
        typeof to === "number" && to < 0 ? "back" : "forward";
      setDirection(direction);

      if (typeof to === "number") {
        navigate(to);
        return;
      }

      navigate(to, {
        ...opts,
        // 不支持时不要传给 router，避免无意义的 dev 警告；false 仍会走 CSS fallback
        viewTransition: supportsViewTransitions
          ? (opts?.viewTransition ?? !prefersReducedMotion())
          : false,
      });
    },
    [navigate],
  );
}
