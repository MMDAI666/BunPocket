import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * 二级页返回：有应用内历史则回退（location.key 非 "default" 说明经历过
 * 应用内跳转）；当前页是初始落地页（如深链/状态恢复直接打开）时没有
 * 可回退的历史，兜底替换到首页。
 */
export function useAppBack() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (location.key !== "default") {
      navigate(-1);
    } else {
      navigate("/", { replace: true });
    }
  }, [navigate, location.key]);
}
