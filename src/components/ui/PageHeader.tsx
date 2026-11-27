import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

interface PageHeaderProps {
  title: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  right?: ReactNode;
}

/** 统一内页顶栏：返回 + 居中标题 + 可选右侧操作。 */
export function PageHeader({ title, onBack, backLabel, right }: PageHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 px-3 pt-[max(env(safe-area-inset-top),0.5rem)]">
      <div className="flex h-11 items-center gap-1">
        {onBack ? (
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-chip active:bg-chip"
            onClick={onBack}
            aria-label={backLabel ?? t("common.back")}
          >
            <ChevronLeft size={22} strokeWidth={1.9} />
          </button>
        ) : (
          <span className="h-9 w-9 shrink-0" />
        )}
        <div className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-ink">
          {title}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-end">
          {right}
        </div>
      </div>
    </div>
  );
}
