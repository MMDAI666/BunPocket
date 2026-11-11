import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { Info, Tags, Wallet } from "lucide-react";
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
  listPreRestoreSnapshots,
  restoreLatestBackup,
  restorePreRestoreSnapshot,
  setKeepCount,
  type RestoreResult,
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
  const [preRestoreCount, setPreRestoreCount] = useState(0);
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
      setPreRestoreCount((await listPreRestoreSnapshots()).length);
    } catch {
      /* 浏览器环境 */
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
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
          <div className="pt-3 pb-2 text-sm text-ink-2">
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

        <h2 className="px-1 pt-4 pb-2 text-sm font-bold text-ink">
          {t("nav.settings")}
        </h2>
        <div className="divide-y divide-gray-100 rounded-2xl bg-card dark:divide-white/5">
          <SettingsRow
            icon={<Tags size={16} className="text-ink-3" />}
            label={t("settings.categoryManage")}
            onClick={() => navigate("/categories")}
          />
          <SettingsRow
            icon={<Wallet size={16} className="text-ink-3" />}
            label={t("settings.budget")}
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
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-card px-4 py-3.5">
          <Info size={16} className="text-ink-3" />
          <span className="flex-1 text-[15px] text-ink">
            {t("settings.version")}
          </span>
          <span className="text-sm text-ink-3">{version ?? "—"}</span>
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

      {/* 旧版本恢复已暂存：必须常驻提示，避免用户以为提示已过继续记账 */}
      <Sheet
        open={restartNotice}
        onOpenChange={setRestartNotice}
        title={t("backup.restartTitle")}
        footer={
          <button
            type="button"
            className="w-full rounded-full bg-gradient-to-r from-brand-1 to-brand-2 py-2.5 text-sm font-medium text-white"
            onClick={() => setRestartNotice(false)}
          >
            {t("common.ok")}
          </button>
        }
      >
        <p className="px-1 py-2 text-sm leading-6 text-ink-2">
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
        "flex w-full items-center px-4 py-3.5 text-left text-[15px]",
        disabled ? "opacity-45" : "text-ink active:bg-chip",
      )}
      onClick={onClick}
    >
      {icon != null && <span className="mr-2">{icon}</span>}
      <span className={cn("flex-1", disabled ? "text-ink-3" : "text-ink")}>
        {label}
      </span>
      {value != null && <span className="mr-2 text-sm text-ink-3">{value}</span>}
      <span className="text-ink-3">›</span>
    </button>
  );
}
