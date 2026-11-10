import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Segmented } from "../components/ui/Segmented";
import { Sheet } from "../components/ui/Sheet";
import { Confirm } from "../components/ui/Confirm";
import { Wheel } from "../components/ui/Wheel";
import { toast } from "../components/ui/Toast";
import { useAppBack } from "../hooks/useAppBack";
import { useTheme, type ThemeSetting } from "../hooks/useTheme";
import { useLocale } from "../hooks/useLocale";
import type { LocaleSetting } from "../i18n";
import {
  backupNow,
  getKeepCount,
  listBackups,
  restoreLatestBackup,
  setKeepCount,
} from "../lib/backup";
import { cn } from "../lib/cn";

const KEEP_RANGE = Array.from({ length: 30 }, (_, i) => i + 1);

export function Settings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const goBack = useAppBack();
  const { setting: theme, update: setTheme } = useTheme();
  const { setting: localeSetting, locale, update: setLocale } = useLocale();

  const [keep, setKeep] = useState<number | null>(null);
  const [keepSheet, setKeepSheet] = useState(false);
  const [keepDraft, setKeepDraft] = useState(1);
  const [lastBackup, setLastBackup] = useState<Date | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  /** 备份/恢复是 IO 重操作（恢复还会换库文件）：全程加锁防重复触发 */
  const [backupBusy, setBackupBusy] = useState(false);

  const refreshBackupInfo = async () => {
    try {
      setKeep(await getKeepCount());
      const backups = await listBackups();
      setLastBackup(backups[0]?.date ?? null);
      setHasBackup(backups.length > 0);
    } catch {
      /* 浏览器环境 */
    }
  };

  useEffect(() => {
    void refreshBackupInfo();
  }, []);

  const formatTime = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(d);

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="flex items-center px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-1">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-ink active:bg-chip"
          onClick={goBack}
          aria-label={t("common.back")}
        >
          ‹
        </button>
        <div className="flex-1 text-center text-base font-semibold text-ink">
          {t("settings.title")}
        </div>
        <div className="w-10" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
        <h2 className="px-1 pt-3 pb-2 text-sm font-bold text-ink">
          {t("settings.appearance")}
        </h2>
        <div className="rounded-2xl bg-card px-4 py-3">
          <div className="pb-2 text-sm text-ink-2">{t("settings.theme")}</div>
          <Segmented<ThemeSetting>
            options={[
              { value: "auto", label: t("settings.themeAuto") },
              { value: "light", label: t("settings.themeLight") },
              { value: "dark", label: t("settings.themeDark") },
            ]}
            value={theme}
            onChange={(v) => void setTheme(v)}
          />
          <div className="pt-3 pb-2 text-sm text-ink-2">{t("settings.language")}</div>
          <Segmented<LocaleSetting>
            options={[
              { value: "auto", label: t("settings.languageAuto") },
              { value: "zh-CN", label: "中文" },
              { value: "en-US", label: "English" },
            ]}
            value={localeSetting}
            onChange={(v) => void setLocale(v)}
          />
        </div>

        <h2 className="px-1 pt-4 pb-2 text-sm font-bold text-ink">
          {t("nav.settings")}
        </h2>
        <div className="divide-y divide-gray-100 rounded-2xl bg-card dark:divide-white/5">
          <SettingsRow
            label={`🏷 ${t("settings.categoryManage")}`}
            onClick={() => navigate("/categories")}
          />
          <SettingsRow
            label={`💰 ${t("settings.budget")}`}
            onClick={() => navigate("/budget")}
          />
        </div>

        {/* 数据备份 */}
        <h2 className="px-1 pt-4 pb-2 text-sm font-bold text-ink">
          {t("settings.dataBackup")}
        </h2>
        <div className="divide-y divide-gray-100 rounded-2xl bg-card dark:divide-white/5">
          <div className="flex items-center px-4 py-3.5">
            <span className="flex-1 text-[15px] text-ink">
              {t("backup.lastTime")}
            </span>
            <span className="text-sm text-ink-3">
              {lastBackup ? formatTime(lastBackup) : t("backup.never")}
            </span>
          </div>
          <SettingsRow
            label={t("backup.keepCount")}
            value={
              keep != null
                ? `${keep} ${t("backup.countUnit")}`.trim()
                : undefined
            }
            onClick={() => {
              if (keep != null) setKeepDraft(keep);
              setKeepSheet(true);
            }}
          />
          <SettingsRow
            label={t("backup.now")}
            disabled={backupBusy}
            onClick={() => {
              if (backupBusy) return;
              setBackupBusy(true);
              void backupNow()
                .then(() => toast.show(t("backup.done")))
                .then(refreshBackupInfo)
                .catch(() => toast.show(t("backup.failed"), "error"))
                .finally(() => setBackupBusy(false));
            }}
          />
          <SettingsRow
            label={t("backup.restore")}
            disabled={!hasBackup || backupBusy}
            value={hasBackup ? undefined : t("backup.noBackup")}
            onClick={() => setConfirmRestore(true)}
          />
        </div>

        <h2 className="px-1 pt-4 pb-2 text-sm font-bold text-ink"> </h2>
        <div className="rounded-2xl bg-card">
          <SettingsRow label={`🐰 ${t("settings.about")}`} onClick={() => undefined} />
        </div>
      </div>

      {/* 保留份数滚轮 */}
      <Sheet
        open={keepSheet}
        onOpenChange={setKeepSheet}
        title={t("backup.keepCount")}
      >
        <Wheel items={KEEP_RANGE} value={keepDraft} onChange={setKeepDraft} />
        <button
          type="button"
          className="mt-2 w-full rounded-full bg-gradient-to-r from-brand-1 to-brand-2 py-2.5 text-sm font-medium text-white"
          onClick={() => {
            void setKeepCount(keepDraft)
              .then(refreshBackupInfo)
              .catch(() => toast.show(t("backup.failed"), "error"))
              .finally(() => setKeepSheet(false));
          }}
        >
          {t("common.ok")}
        </button>
      </Sheet>

      <Confirm
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        title={t("backup.restoreTitle")}
        content={t("backup.restoreContent")}
        danger
        onConfirm={() => {
          if (backupBusy) return;
          setBackupBusy(true);
          void restoreLatestBackup()
            .then((result) => {
              if (result === "restart-required") {
                toast.show(t("backup.restartRequired"));
              }
            })
            .catch((err: unknown) => {
              const code = err instanceof Error ? err.message : "";
              if (code === "backup-from-newer-version") {
                toast.show(t("backup.tooNew"), "error");
              } else if (code === "backup-version-mismatch") {
                toast.show(t("backup.versionMismatch"), "error");
              } else if (
                code === "backup-integrity" ||
                code === "backup-invalid"
              ) {
                toast.show(t("backup.integrityFailed"), "error");
              } else {
                toast.show(t("backup.failed"), "error");
              }
            })
            .finally(() => setBackupBusy(false));
        }}
      />
    </div>
  );
}

function SettingsRow({
  label,
  value,
  disabled = false,
  onClick,
}: {
  label: string;
  value?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex w-full items-center px-4 py-3.5 text-left text-[15px]",
        disabled ? "opacity-45" : "text-ink active:bg-chip",
      )}
      onClick={onClick}
    >
      <span className={cn("flex-1", disabled ? "text-ink-3" : "text-ink")}>
        {label}
      </span>
      {value != null && <span className="mr-2 text-sm text-ink-3">{value}</span>}
      <span className="text-ink-3">›</span>
    </button>
  );
}
