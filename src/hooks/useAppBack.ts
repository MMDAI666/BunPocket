import { useCallback } from "react";
import { useAppNavigate } from "./useAppNavigate";

/**
 * 二级页返回：应用内历史存在（history.state.idx > 0）就回退，
 * 否则 replace 到 fallback（默认首页）。
 *
 * 用 history.state.idx 而不是 location.key：data router 下 replace 也会换 key，
 * 但不会新增历史；idx 才代表真实可回退层级。
 */
export function useAppBack(fallback = "/") {
  const navigate = useAppNavigate();
  return useCallback(() => {
    const idx =
      typeof window !== "undefined"
        ? (window.history.state as { idx?: number } | null)?.idx
        : undefined;
    if (typeof idx === "number" && idx > 0) {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  }, [navigate, fallback]);
}
