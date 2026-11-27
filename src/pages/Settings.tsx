import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { ChevronRight, Info, Tags, Wallet } from "lucide-react";
import { Segmented } from "../components/ui/Segmented";
import { Sheet } from "../components/ui/Sheet";
import { Confirm } from "../components/ui/Confirm";
import { Wheel } from "../components/ui/Wheel";
import { PageHeader } from "../components/ui/PageHeader";
import { toast } from "../components/ui/Toast";
import { useAppBack } from "../hooks/useAppBack";
import { useAppNavigate } from "../hooks/useAppNavigate";
import { useTheme, type ThemeSetting } from "../hooks/useTheme";
import { useLocale } from "../hooks/useLocale";
import type { LocaleSetting } from "../i18n";
import {
  backupNow,
  getKeepCount,
  listBackups,
  listPreRestoreSnapshots,
  restoreLatestBackup,
  restorePreRestoreSnapshot,
  setKeepCount,
  type RestoreResult,
} from "../lib/backup";
import { errorMessage, getLogKeepDays, logEvent } from "../lib/logger";
import { cn } from "../lib/cn";

const KEEP_RANGE = Array.from({ length: 30 }, (_, i) => i + 1);

export function Settings() {
  const { t } = useTranslation();
  const navigate = useAppNavigate();
  const goBack = useAppBack();
  const { setting: theme, update: setTheme } = useTheme();
  const { setting: localeSetting, locale, update: setLocale } = useLocale();

  const [keep, setKeep] = useState<number | null>(null);
  const [keepSheet, setKeepSheet] = useState(false);
  const [keepDraft, setKeepDraft] = useState(1);
  const [lastBackup, setLastBackup] = useState<Date | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [backupCount, setBackupCount] = useState(0);
  const [preRestoreCount, setPreRestoreCount] = useState(0);
  const [logDays, setLogDays] = useState<number | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmPreRestore, setConfirmPreRestore] = useState(false);
  /** 旧 schema 恢复已暂存 pending-restore：必须提示用户立即完全退出应用，否则期间新账会在重启换库时被覆盖 */
  const [restartNotice, setRestartNotice] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  /** 备份/恢复是 IO 重操作（恢复还会换库文件）：全程加锁防重复触发 */
  const [backupBusy, setBackupBusy] = useState(false);

  const refreshBackupInfo = async () => {
    try {
      setKeep(await getKeepCount());
      const backups = await listBackups();
      setLastBackup(backups[0]?.date ?? null);
      setHasBackup(backups.length > 0);
      setBackupCount(backups.length);
      setPreRestoreCount((await listPreRestoreSnapshots()).length);
      setLogDays(await getLogKeepDays());
    } catch (error) {
      /* 浏览器环境没有备份目录；Tauri 下失败也留一条日志 */
      void logEvent("warn", "settings.backupInfo.failed", {
        message: errorMessage(error),
      });
    }
  };

  useEffect(() => {
    void refreshBackupInfo();
    void getVersion()
      .then((v) => setVersion(v))
      .catch(() => {
        /* 浏览器 dev 环境没有 Tauri app API */
      });
  }, []);

  const formatTime = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(d);

  const runRestore = (restore: () => Promise<RestoreResult>) => {
    if (backupBusy) return;
    setBackupBusy(true);
    void restore()
      .then((result) => {
        if (result === "restart-required") {
          setRestartNotice(true);
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
          code === "backup-invalid" ||
          code.startsWith("backup-migration-") ||
          code === "backup-checksum-mismatch"
        ) {
          toast.show(t("backup.integrityFailed"), "error");
        } else {
          toast.show(t("backup.failed"), "error");
        }
      })
      .finally(() => {
        // 恢复流程可能已生成新的恢复前快照（restart-required/失败时），刷新计数让入口可用
        void refreshBackupInfo();
        setBackupBusy(false);
      });
  };

  return (
    <div className="flex h-full flex-col bg-page">
      <PageHeader title={t("settings.title")} onBack={goBack} />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        <SectionLabel>{t("settings.appearance")}</SectionLabel>
        <div className="paper px-4 py-3">
          <div className="pb-2 text-[12px] text-ink-2">{t("settings.theme")}</div>
          <Segmented<ThemeSetting>
            options={[
              { value: "auto", label: t("settings.themeAuto") },
              { value: "light", label: t("settings.themeLight") },
              { value: "dark", label: t("settings.themeDark") },
            ]}
            value={theme}
            onChange={(v) => void setTheme(v)}
          />
          <div className="pt-3.5 pb-2 text-[12px] text-ink-2">
            {t("settings.language")}
          </div>
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

        <SectionLabel>{t("nav.settings")}</SectionLabel>
        <div className="paper divide-y divide-line">
          <SettingsRow
            icon={<Tags size={16} strokeWidth={1.8} />}
            label={t("settings.categoryManage")}
            onClick={() => navigate("/categories")}
          />
          <SettingsRow
            icon={<Wallet size={16} strokeWidth={1.8} />}
            label={t("settings.budget")}
            onClick={() => navigate("/budget")}
          />
        </div>

        <SectionLabel>{t("settings.dataBackup")}</SectionLabel>
        <div className="paper divide-y divide-line">
          <div className="flex items-center px-4 py-3.5">
            <span className="flex-1 text-[13px] text-ink">
              {t("backup.lastTime")}
            </span>
            <span className="text-[11px] text-ink-3">
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
          <SettingsRow
            label={t("backup.pickRestore")}
            disabled={!hasBackup || backupBusy}
            value={
              hasBackup
                ? `${backupCount} ${t("backup.countUnit")}`
                : t("backup.noBackup")
            }
            onClick={() => navigate("/backups")}
          />
          <SettingsRow
            label={t("backup.preRestore")}
            disabled={preRestoreCount === 0 || backupBusy}
            value={
              preRestoreCount > 0
                ? `${preRestoreCount}`
                : t("backup.none")
            }
            onClick={() => setConfirmPreRestore(true)}
          />
          <SettingsRow
            label={t("logs.title")}
            value={
              logDays != null
                ? `${logDays} ${t("logs.daysUnit")}`
                : undefined
            }
            onClick={() => navigate("/logs")}
          />
        </div>

        <div className="paper mt-3 flex items-center gap-2 px-4 py-3.5">
          <Info size={16} strokeWidth={1.8} className="text-ink-3" />
          <span className="flex-1 text-[13px] text-ink">
            {t("settings.version")}
          </span>
          <span className="num text-[11px] text-ink-3">{version ?? "—"}</span>
        </div>
      </div>

      {/* 保留份数滚轮 */}
      <Sheet
        open={keepSheet}
        onOpenChange={setKeepSheet}
        title={t("backup.keepCount")}
      >
        <Wheel
          items={KEEP_RANGE}
          value={keepDraft}
          onChange={setKeepDraft}
          ariaLabel={t("backup.keepCount")}
        />
        <button
          type="button"
          className="mt-2 w-full rounded-[10px] bg-book py-2.5 text-[13px] font-medium text-cream"
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

      {/* 旧版本恢复已暂存：必须常驻提示，避免用户以为提示已过继续记账 */}
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

      <Confirm
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        title={t("backup.restoreTitle")}
        content={t("backup.restoreContent")}
        danger
        onConfirm={() => runRestore(restoreLatestBackup)}
      />

      <Confirm
        open={confirmPreRestore}
        onOpenChange={setConfirmPreRestore}
        title={t("backup.preRestoreTitle")}
        content={t("backup.preRestoreContent")}
        danger
        onConfirm={() => runRestore(restorePreRestoreSnapshot)}
      />
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="px-1 pt-4 pb-2 text-[11px] font-semibold text-ink-3">
      {children}
    </h2>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  disabled = false,
  onClick,
}: {
  icon?: ReactNode;
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
        "flex w-full items-center gap-2.5 px-4 py-3.5 text-left text-[13px] transition-colors",
        disabled ? "opacity-45" : "text-ink hover:bg-chip/50 active:bg-chip",
      )}
      onClick={onClick}
    >
      {icon != null && <span className="text-ink-3">{icon}</span>}
      <span className={cn("flex-1", disabled ? "text-ink-3" : "text-ink")}>
        {label}
      </span>
      {value != null && (
        <span className="mr-1 text-[11px] text-ink-3">{value}</span>
      )}
      <ChevronRight size={15} strokeWidth={1.8} className="shrink-0 text-ink-3" />
    </button>
  );
}
