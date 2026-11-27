import { useTranslation } from "react-i18next";
import { CircleAlert } from "lucide-react";

interface ErrorStateProps {
  /** 提供则显示重试按钮 */
  onRetry?: () => void;
}

/** DB/加载失败时的统一错误占位：明确告诉用户是"读取失败"，而不是"没有数据" */
export function ErrorState({ onRetry }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div className="paper flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <CircleAlert size={24} strokeWidth={1.7} className="text-ink-3" />
      <div className="text-[13px] text-ink-2">{t("common.loadFailed")}</div>
      {onRetry && (
        <button
          type="button"
          className="rounded-[9px] border border-line px-4 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-chip active:bg-chip"
          onClick={onRetry}
        >
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}
