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
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-card px-6 py-10 text-center">
      <CircleAlert size={26} className="text-ink-3" />
      <div className="text-sm text-ink-2">{t("common.loadFailed")}</div>
      {onRetry && (
        <button
          type="button"
          className="rounded-full border border-line px-4 py-1.5 text-sm text-ink-2 active:bg-chip"
          onClick={onRetry}
        >
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}
