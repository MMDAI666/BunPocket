import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { useAppBack } from "../hooks/useAppBack";
import { useLocale } from "../hooks/useLocale";
import {
  listBackups,
  restoreBackupByName,
  type BackupInfo,
} from "../lib/backup";
import { errorMessage, logEvent } from "../lib/logger";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { Confirm } from "../components/ui/Confirm";
import { toast } from "../components/ui/Toast";
import { cn } from "../lib/cn";

/**
 * 历史备份恢复：列出保留期内的所有备份，由用户指定其中一份。
 * 只尝试选中的那一份：校验失败/来自更新版本会直接报错，不会静默换成别的备份。
 */
export function Backups() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const goBack = useAppBack("/settings");
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restartNotice, setRestartNotice] = useState(false);

  useEffect(() => {
    let alive = true;
    void listBackups()
      .then((items) => {
        if (!alive) return;
        setBackups(items);
        void logEvent("info", "backup.list.open", { count: items.length });
      })
      .catch((error) => {
        if (!alive) return;
        setBackups([]);
        void logEvent("warn", "backup.list.failed", {
          message: errorMessage(error),
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(date);

  const selectedInfo =
    backups?.find((backup) => backup.name === selected) ?? null;

  const runRestore = () => {
    if (!selectedInfo || busy) return;
    setBusy(true);
    void restoreBackupByName(selectedInfo.name)
      .then((result) => {
        if (result === "restart-required") setRestartNotice(true);
      })
      .catch((error) => {
        const code = error instanceof Error ? error.message : "";
        if (code === "backup-from-newer-version") {
          toast.show(t("backup.tooNew"), "error");
        } else if (
          code === "backup-integrity" ||
          code === "backup-invalid" ||
          code.startsWith("backup-migration-") ||
          code === "backup-checksum-mismatch"
        ) {
          toast.show(t("backup.integrityFailed"), "error");
        } else {
          toast.show(t("backup.failed"), "error");
        }
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex h-full flex-col bg-page">
      <PageHeader title={t("backup.pickTitle")} onBack={goBack} />

      <div className="px-4 pb-2 text-[11px] leading-5 text-ink-3">
        {t("backup.pickHint")}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {backups === null ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">
            …
          </div>
        ) : backups.length === 0 ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">
            {t("backup.noBackup")}
          </div>
        ) : (
          <div className="paper divide-y divide-line overflow-hidden">
            {backups.map((backup, index) => {
              const active = backup.name === selected;
              return (
                <button
                  key={backup.name}
                  type="button"
                  disabled={busy}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                    active
                      ? "bg-brand-soft"
                      : "hover:bg-chip/50 active:bg-chip",
                    busy && "opacity-60",
                  )}
                  onClick={() => setSelected(backup.name)}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      active
                        ? "border-book bg-book text-cream"
                        : "border-line",
                    )}
                  >
                    {active && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">
                      {formatDate(backup.date)}
                    </span>
                    <span className="block truncate text-[10px] text-ink-3">
                      {backup.name}
                    </span>
                  </span>
                  {index === 0 && (
                    <span className="shrink-0 rounded-[4px] bg-brand-soft px-1.5 py-0.5 text-[9px] font-medium text-brand">
                      {t("backup.latest")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-line px-4 py-3">
        <button
          type="button"
          disabled={!selectedInfo || busy}
          className={cn(
            "w-full rounded-[10px] bg-book py-2.5 text-[13px] font-medium text-cream transition-opacity",
            (!selectedInfo || busy) && "opacity-40",
          )}
          onClick={() => setConfirmOpen(true)}
        >
          {t("backup.restoreThis")}
        </button>
      </div>

      <Confirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("backup.restoreTitle")}
        content={
          selectedInfo
            ? t("backup.pickedContent", {
                time: formatDate(selectedInfo.date),
              })
            : undefined
        }
        danger
        onConfirm={runRestore}
      />

      <Sheet
        open={restartNotice}
        onOpenChange={setRestartNotice}
        title={t("backup.restartTitle")}
        footer={
          <button
            type="button"
            className="w-full rounded-[10px] bg-book py-2.5 text-[13px] font-medium text-cream"
            onClick={() => setRestartNotice(false)}
          >
            {t("common.ok")}
          </button>
        }
      >
        <p className="px-1 py-2 text-[13px] leading-6 text-ink-2">
          {t("backup.restartContent")}
        </p>
      </Sheet>
    </div>
  );
}
