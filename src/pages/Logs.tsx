import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, RefreshCw, Trash2 } from "lucide-react";
import { useAppBack } from "../hooks/useAppBack";
import {
  LOG_KEEP_OPTIONS,
  clearLogs,
  errorMessage,
  getLogKeepDays,
  logEvent,
  pruneLogs,
  readLogs,
  setLogKeepDays,
} from "../lib/logger";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { Wheel } from "../components/ui/Wheel";
import { Confirm } from "../components/ui/Confirm";
import { ErrorState } from "../components/ui/ErrorState";
import { toast } from "../components/ui/Toast";
import { cn } from "../lib/cn";

/** 运行日志：查看按天滚动的日志文件，并配置保留天数 / 清空 */
export function Logs() {
  const { t } = useTranslation();
  const goBack = useAppBack("/settings");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [logs, setLogs] = useState("");
  const [keepDays, setKeepDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [draft, setDraft] = useState(7);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const days = await getLogKeepDays();
      // 打开日志页也执行一次保留期清理，避免长期不重启时旧文件一直留着
      await pruneLogs(days).catch(() => {
        /* 清理失败仍可查看 */
      });
      const text = await readLogs();
      setLogs(text);
      setKeepDays(days);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // 只加载一次：页面内刷新用右上角按钮
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新日志在文件末尾，打开时直接看最新
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const saveKeepDays = async () => {
    try {
      await setLogKeepDays(draft);
      setKeepOpen(false);
      await refresh();
    } catch (error) {
      toast.show(t("common.saveFailed"), "error");
      void logEvent("error", "log.retention.failed", {
        days: draft,
        message: errorMessage(error),
      });
    }
  };

  const onClear = async () => {
    setClearing(true);
    try {
      await clearLogs();
      toast.show(t("logs.cleared"));
      await refresh();
    } catch (error) {
      toast.show(t("logs.clearFailed"), "error");
      void logEvent("error", "log.clear.failed", {
        message: errorMessage(error),
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-page">
      <PageHeader
        title={t("logs.title")}
        onBack={goBack}
        right={
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-chip active:bg-chip"
            onClick={() => void refresh()}
            aria-label={t("logs.refresh")}
          >
            <RefreshCw size={16} strokeWidth={1.9} />
          </button>
        }
      />

      <div className="px-3 pb-2">
        <div className="paper divide-y divide-line">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-3.5 text-left text-[13px] text-ink transition-colors hover:bg-chip/50 active:bg-chip"
            onClick={() => {
              setDraft(keepDays ?? 7);
              setKeepOpen(true);
            }}
          >
            <span className="flex-1">{t("logs.keepDays")}</span>
            <span className="text-[11px] text-ink-3">
              {keepDays == null
                ? "—"
                : `${keepDays} ${t("logs.daysUnit")}`}
            </span>
            <ChevronRight
              size={15}
              strokeWidth={1.8}
              className="shrink-0 text-ink-3"
            />
          </button>
          <button
            type="button"
            disabled={clearing || logs === ""}
            className={cn(
              "flex w-full items-center gap-2 px-4 py-3.5 text-left text-[13px] transition-colors",
              clearing || logs === ""
                ? "text-ink-3 opacity-50"
                : "text-danger hover:bg-chip/50 active:bg-chip",
            )}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 size={15} strokeWidth={1.8} />
            <span className="flex-1">{t("logs.clear")}</span>
          </button>
        </div>
        <p className="px-1 pt-2 text-[11px] leading-5 text-ink-3">
          {t("logs.hint")}
        </p>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(2rem+env(safe-area-inset-bottom))]"
      >
        {failed ? (
          <ErrorState onRetry={() => void refresh()} />
        ) : loading ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">
            …
          </div>
        ) : logs === "" ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">
            {t("logs.empty")}
          </div>
        ) : (
          <div className="paper p-3">
            <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-5 text-ink-2">
              {logs}
            </pre>
          </div>
        )}
      </div>

      <Sheet
        open={keepOpen}
        onOpenChange={setKeepOpen}
        title={t("logs.keepDays")}
      >
        <Wheel
          items={LOG_KEEP_OPTIONS}
          value={draft}
          onChange={setDraft}
          ariaLabel={t("logs.keepDays")}
          render={(value) => `${value} ${t("logs.daysUnit")}`}
        />
        <button
          type="button"
          className="mt-2 w-full rounded-[10px] bg-book py-2.5 text-[13px] font-medium text-cream"
          onClick={() => void saveKeepDays()}
        >
          {t("common.ok")}
        </button>
      </Sheet>

      <Confirm
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t("logs.clearTitle")}
        content={t("logs.clearContent")}
        danger
        onConfirm={() => void onClear()}
      />
    </div>
  );
}
