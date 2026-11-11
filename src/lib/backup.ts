import { appConfigDir, join } from "@tauri-apps/api/path";
import {
  copyFile,
  exists,
  mkdir,
  readDir,
  remove,
  rename,
} from "@tauri-apps/plugin-fs";
import Database from "@tauri-apps/plugin-sql";
import { closeDb, getDb } from "../db";
import { getSetting, setSetting } from "../settings";
import { todayStr } from "./format";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const BACKUP_DIR = "backups";
const BACKUP_PREFIX = "bunpocket-";
/** 恢复前自动生成的当前库快照前缀（独立于常规备份轮转，只保留最近一份） */
const PRERESTORE_PREFIX = "prerestore-";
/** 待下次启动应用的恢复文件后缀（旧 schema 备份需要新进程重跑迁移） */
const PENDING_RESTORE_SUFFIX = ".pending-restore";
const DEFAULT_KEEP = 7;
const MAX_KEEP = 30;

export interface BackupInfo {
  name: string;
  date: Date;
}

/** 恢复结果：reloaded = 本次已换库并刷新页面；restart-required = 已准备换库，需完全重启应用 */
export type RestoreResult = "reloaded" | "restart-required";

/**
 * 备份/恢复串行锁：VACUUM/校验/换库都会操作同一个数据库与目录，
 * 避免 ensureDailyBackup（启动时 fire-and-forget）与用户手动恢复并发。
 */
let ioChain: Promise<unknown> = Promise.resolve();
function withBackupLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = ioChain.then(fn, fn);
  ioChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function backupDirPath(): Promise<string> {
  const base = await appConfigDir();
  if (!base) throw new Error("appConfigDir unavailable");
  return join(base, BACKUP_DIR);
}

async function dbFilePath(): Promise<string> {
  const base = await appConfigDir();
  if (!base) throw new Error("appConfigDir unavailable");
  return join(base, "bunpocket.db");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function timestamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

function backupFileName(prefix: string, d = new Date()): string {
  return `${prefix}${timestamp(d)}.db`;
}

function parseBackupName(name: string): Date | null {
  const m = name.match(
    /^bunpocket-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/,
  );
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** 现有备份列表，最新在前（文件名含时间戳，字典序即时间序）；目录不存在视为无备份 */
export async function listBackups(): Promise<BackupInfo[]> {
  if (!isTauri) return [];
  let entries;
  try {
    entries = await readDir(await backupDirPath());
  } catch {
    return [];
  }
  return entries
    .filter(
      (e) =>
        e.isFile && e.name.startsWith(BACKUP_PREFIX) && e.name.endsWith(".db"),
    )
    .map((e) => ({ name: e.name, date: parseBackupName(e.name) ?? new Date(0) }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

export async function getKeepCount(): Promise<number> {
  const n = Number(await getSetting("backup_keep"));
  return Number.isInteger(n) && n >= 1 && n <= MAX_KEEP ? n : DEFAULT_KEEP;
}

export async function setKeepCount(count: number): Promise<void> {
  const clamped = Math.min(Math.max(Math.round(count), 1), MAX_KEEP);
  await setSetting("backup_keep", String(clamped));
}

/**
 * 校验备份库完整性并返回其 schema 版本（_sqlx_migrations 最大 version）。
 * relativePath 是相对 app_config_dir 的路径（与 tauri-plugin-sql 的路径映射一致），
 * 允许校验 backups/*.db、*.db.partial 以及 pending-restore 文件。
 */
async function verifyBackupAt(relativePath: string): Promise<number> {
  let db: Database | null = null;
  const key = `sqlite:${relativePath}`;
  try {
    db = await Database.load(key);
    const integrity = await db.select<{ integrity_check: string }[]>(
      "PRAGMA integrity_check",
    );
    if (integrity[0]?.integrity_check !== "ok") {
      throw new Error("backup-integrity");
    }
    const rows = await db.select<{ version: number | null }[]>(
      "SELECT MAX(version) AS version FROM _sqlx_migrations",
    );
    const version = rows[0]?.version;
    if (typeof version !== "number" || !Number.isInteger(version)) {
      throw new Error("backup-invalid");
    }
    const failed = await db.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM _sqlx_migrations WHERE success = 0",
    );
    if ((failed[0]?.n ?? 0) > 0) throw new Error("backup-migration-failed");
    return version;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("backup-")) throw e;
    throw new Error("backup-invalid");
  } finally {
    // 必须显式指定 db 名：无参 close() 会关闭全部连接池（包括主库）
    await db
      ?.close(key)
      .catch((e) => console.warn("close backup db failed:", e));
  }
}

async function verifyBackupFile(name: string): Promise<number> {
  return verifyBackupAt(`${BACKUP_DIR}/${name}`);
}

interface MigrationRow {
  version: number;
  checksum: string;
  success: number;
}

/** 主库迁移记录（主库连接池已打开，不能 close） */
async function currentMigrationRows(): Promise<MigrationRow[]> {
  const db = await getDb();
  return db.select<MigrationRow[]>(
    "SELECT version, hex(checksum) AS checksum, success FROM _sqlx_migrations ORDER BY version",
  );
}

/** 读取备份文件的迁移记录（独立 pool key，用完显式 close 该 key） */
async function backupMigrationRows(relativePath: string): Promise<MigrationRow[]> {
  let db: Database | null = null;
  const key = `sqlite:${relativePath}`;
  try {
    db = await Database.load(key);
    return await db.select<MigrationRow[]>(
      "SELECT version, hex(checksum) AS checksum, success FROM _sqlx_migrations ORDER BY version",
    );
  } finally {
    await db?.close(key).catch((e) => console.warn("close migration db failed:", e));
  }
}

/**
 * 恢复前校验备份的迁移记录与当前库兼容：
 * - 备份里不能有 success=0 的失败迁移；
 * - 备份已应用的每个版本，当前库必须已应用且 checksum 完全一致（sqlx 启动时同样会校验，
 *   提前拦住可避免"换库成功但应用打不开"）。
 */
async function assertMigrationCompatible(name: string): Promise<void> {
  const currentRows = await currentMigrationRows();
  const current = new Map(currentRows.map((row) => [row.version, row.checksum]));
  const backup = await backupMigrationRows(`${BACKUP_DIR}/${name}`);
  if (backup.length === 0) throw new Error("backup-invalid");
  for (const row of backup) {
    if (!row.success) throw new Error("backup-migration-failed");
    const currentChecksum = current.get(row.version);
    if (!currentChecksum) throw new Error("backup-migration-unapplied");
    if (currentChecksum.toLowerCase() !== row.checksum.toLowerCase()) {
      throw new Error("backup-checksum-mismatch");
    }
  }
}

export async function verifyBackupVersion(name: string): Promise<number> {
  return verifyBackupFile(name);
}

async function currentSchemaVersion(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ version: number | null }[]>(
    "SELECT MAX(version) AS version FROM _sqlx_migrations",
  );
  const version = rows[0]?.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new Error("schema-version-unknown");
  }
  return version;
}

/**
 * VACUUM INTO 原子快照。
 * 先写到 `<name>.db.partial`（不匹配 listBackups 的 .db 过滤，不会被当成有效备份），
 * 校验 integrity_check + schema 版本后再 rename 成正式文件名；
 * 断电/进程被杀只会留下 partial，绝不会产生"看起来有效但已损坏"的最新备份。
 */
async function createBackup(prefix = BACKUP_PREFIX): Promise<BackupInfo> {
  if (!isTauri) throw new Error("fs unavailable");
  const dir = await backupDirPath();
  await mkdir(dir, { recursive: true });
  const date = new Date();
  const name = backupFileName(prefix, date);
  const partialName = `${name}.partial`;
  const finalPath = await join(dir, name);
  const partialPath = await join(dir, partialName);

  try {
    await remove(partialPath);
  } catch {
    /* 无残留 */
  }

  const db = await getDb();
  await db.execute(`VACUUM INTO '${partialPath.replace(/'/g, "''")}'`);
  try {
    await verifyBackupFile(partialName);
  } catch (e) {
    try {
      await remove(partialPath);
    } catch {
      /* 尽力清理 */
    }
    throw e;
  }
  await rename(partialPath, finalPath);
  return { name, date };
}

async function rotateBackups(keep: number): Promise<void> {
  const backups = await listBackups();
  const dir = await backupDirPath();
  for (const old of backups.slice(keep)) {
    try {
      await remove(await join(dir, old.name));
    } catch (e) {
      // 轮转失败不应让"备份已成功"整体失败
      console.warn("remove old backup failed:", old.name, e);
    }
  }
}

export interface PreRestoreSnapshot {
  name: string;
  date: Date;
}

function parsePreRestoreName(name: string): Date | null {
  const m = name.match(
    /^prerestore-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/,
  );
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** 恢复前自动快照列表（最新在前），设置页可手动回退到最近一份 */
export async function listPreRestoreSnapshots(): Promise<PreRestoreSnapshot[]> {
  try {
    const entries = await readDir(await backupDirPath());
    return entries
      .filter(
        (e) =>
          e.isFile &&
          e.name.startsWith(PRERESTORE_PREFIX) &&
          e.name.endsWith(".db"),
      )
      .map((e) => ({
        name: e.name,
        date: parsePreRestoreName(e.name) ?? new Date(0),
      }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

/** 只保留最近一份"恢复前快照"，避免占空间 */
async function cleanupPreRestoreBackups(keep = 1): Promise<void> {
  const list = await listPreRestoreSnapshots();
  const dir = await backupDirPath();
  for (const item of list.slice(keep)) {
    try {
      await remove(await join(dir, item.name));
    } catch {
      /* 清理失败不影响主流程 */
    }
  }
}

/** 手动立即备份（设置页按钮）：备份 + 轮转 */
export async function backupNow(): Promise<BackupInfo> {
  return withBackupLock(async () => {
    const info = await createBackup();
    await setSetting("last_backup_at", info.date.toISOString());
    await rotateBackups(await getKeepCount());
    return info;
  });
}

/** 每天首次连库时调用：当天已有备份（含手动）则只补标记 */
export async function ensureDailyBackup(): Promise<void> {
  if (!isTauri) return;
  return withBackupLock(async () => {
    try {
      const today = todayStr();
      if ((await getSetting("last_backup_date")) === today) return;

      const newest = (await listBackups())[0];
      const d = newest?.date;
      const newestDay = d
        ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
        : "";
      if (newestDay !== today) {
        await createBackup();
      }
      await setSetting("last_backup_date", today);
      await setSetting("last_backup_at", new Date().toISOString());
      await rotateBackups(await getKeepCount());
      await cleanupPreRestoreBackups(1);
    } catch (e) {
      console.warn("daily backup failed:", e);
    }
  });
}

/**
 * 把 newFilePath 换到主库位置。主库与其 sidecar（-wal/-shm/-journal）成组移动到 `.old*`，
 * 保证 `.old` 是一份完整可回退副本；换入失败时成组回滚。
 */
async function replaceMainDbFile(newFilePath: string): Promise<void> {
  const dbPath = await dbFilePath();
  const oldPath = `${dbPath}.old`;

  // 清理上一份 .old：删除失败必须中止，不能带着旧 .old 继续换库
  if (await exists(oldPath)) {
    await remove(oldPath);
  }

  // 主库移走；文件不存在视为首次恢复
  let movedMain = false;
  try {
    await rename(dbPath, oldPath);
    movedMain = true;
  } catch (e) {
    if (await exists(dbPath)) throw e;
  }

  const suffixes = ["-wal", "-shm", "-journal"];
  const movedSidecars: string[] = [];
  if (movedMain) {
    for (const suffix of suffixes) {
      const current = `${dbPath}${suffix}`;
      try {
        if (await exists(current)) {
          await rename(current, `${oldPath}${suffix}`);
          movedSidecars.push(suffix);
        }
      } catch (e) {
        console.warn("move db sidecar failed:", suffix, e);
      }
    }
  }

  try {
    await rename(newFilePath, dbPath);
  } catch (e) {
    // 先恢复 sidecar，再恢复主库
    for (const suffix of movedSidecars) {
      try {
        await rename(`${oldPath}${suffix}`, `${dbPath}${suffix}`);
      } catch {
        /* 尽力回滚 */
      }
    }
    if (movedMain) {
      try {
        await rename(oldPath, dbPath);
      } catch {
        /* 尽力回滚 */
      }
    }
    throw e;
  }
  // 故意保留 oldPath（含 sidecar）：下次恢复前一直留作人工回退副本
}

/** 进程内恢复：先复制到 tmp（主库仍打开），close 后整体换库 */
async function swapMainDbWithBackup(name: string): Promise<void> {
  const dbPath = await dbFilePath();
  const src = await join(await backupDirPath(), name);
  const tmpPath = `${dbPath}-restore-tmp`;
  try {
    await remove(tmpPath);
  } catch {
    /* 无残留 */
  }
  await copyFile(src, tmpPath);
  await closeDb();
  try {
    await replaceMainDbFile(tmpPath);
  } catch (e) {
    try {
      await remove(tmpPath);
    } catch {
      /* 尽力清理 */
    }
    throw e;
  }
}

/**
 * 两阶段恢复真正执行前，把"当前主库"快照到备份目录（prerestore-*）。
 * 暂存 pending 之后用户仍可能继续记账，这份快照保证那些数据在换库后仍可找回。
 */
async function snapshotCurrentDbBeforeApply(): Promise<void> {
  const dbPath = await dbFilePath();
  if (!(await exists(dbPath))) return;
  const dir = await backupDirPath();
  await mkdir(dir, { recursive: true });
  const name = backupFileName(PRERESTORE_PREFIX);
  const target = await join(dir, name);
  await copyFile(dbPath, target);
  // WAL/journal 若存在一并复制，SQLite 打开快照时会据此恢复；shm 可重建，不复制
  for (const suffix of ["-wal", "-journal"]) {
    try {
      if (await exists(`${dbPath}${suffix}`)) {
        await copyFile(`${dbPath}${suffix}`, `${target}${suffix}`);
      }
    } catch {
      /* sidecar 复制失败不影响主库 */
    }
  }
  try {
    await verifyBackupFile(name);
  } catch (e) {
    console.warn("pre-apply snapshot invalid:", e);
  }
}

/**
 * 应用启动时（打开 DB 之前）把上次准备好的 pending-restore 换入主库位置。
 * 旧 schema 备份需要新进程跑迁移，所以不能在当前进程用 reload 完成。
 * 换库前会先快照"当前主库"，避免暂存 pending 之后新记的账在重启时静默丢失。
 */
export async function applyPendingRestore(): Promise<boolean> {
  if (!isTauri) return false;
  const dbPath = await dbFilePath();
  const pendingPath = `${dbPath}${PENDING_RESTORE_SUFFIX}`;
  let pendingExists = false;
  try {
    pendingExists = await exists(pendingPath);
  } catch {
    return false;
  }
  if (!pendingExists) return false;

  // pending 是拷贝出来的文件，拷贝中断可能留下半成品：换库前必须校验完整性
  try {
    await verifyBackupAt(`bunpocket.db${PENDING_RESTORE_SUFFIX}`);
  } catch (e) {
    console.warn("pending restore file invalid, skipped:", e);
    // 无效 pending 必须清掉，否则每次启动都重复校验；同时留标记让 UI 提示用户
    try {
      await remove(pendingPath);
    } catch {
      /* 忽略 */
    }
    try {
      localStorage.setItem("bp:restore-error", "1");
    } catch {
      /* 忽略 */
    }
    return false;
  }

  // 暂存 pending 之后用户可能又记了账：换库前把当前主库快照到 prerestore-*
  try {
    await snapshotCurrentDbBeforeApply();
  } catch (e) {
    console.warn("snapshot current db before pending restore failed:", e);
  }

  await replaceMainDbFile(pendingPath);
  return true;
}

/**
 * 从候选文件名里挑第一份"可用且 schema 版本不高于当前"的恢复：
 * 同版本：本进程内换库并 reload；旧版本：写 pending-restore 返回 restart-required；
 * 新版本：跳过（提示先升级应用）。调用方需已持有 withBackupLock。
 *
 * @param backupBeforeRestore 是否在恢复前生成"当前库快照"。从常规备份恢复时为 true；
 *        从 prerestore 快照恢复时必须为 false——否则新快照 + 只保留一份的清理会删掉
 *        正在恢复的那份快照。
 */
async function restoreCandidates(
  names: string[],
  backupBeforeRestore = true,
): Promise<RestoreResult> {
  if (!isTauri) throw new Error("fs unavailable");
  if (names.length === 0) throw new Error("no-backup");

  // 清掉可能残留的 pending（上次两阶段恢复已准备好但用户没重启，又重新发起恢复）
  try {
    await remove(`${(await dbFilePath())}${PENDING_RESTORE_SUFFIX}`);
  } catch {
    /* 无残留 */
  }

  const currentVersion = await currentSchemaVersion();
  let chosen: { name: string; version: number } | null = null;
  let lastError = "";
  for (const name of names) {
    try {
      const version = await verifyBackupFile(name);
      if (version > currentVersion) {
        lastError = "backup-from-newer-version";
        continue;
      }
      // 迁移 checksum/dirty 不兼容的备份直接跳过，避免换库后 sqlx 打不开
      await assertMigrationCompatible(name);
      chosen = { name, version };
      break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "backup-invalid";
    }
  }
  if (!chosen) throw new Error(lastError || "backup-invalid");

  if (backupBeforeRestore) {
    // 恢复前快照（当前数据），误恢复时可从备份目录的 prerestore-* 手动找回
    await createBackup(PRERESTORE_PREFIX);
    await cleanupPreRestoreBackups(1);
  }

  const dbPath = await dbFilePath();
  if (chosen.version === currentVersion) {
    await swapMainDbWithBackup(chosen.name);
    location.reload();
    return "reloaded";
  }

  // 旧 schema：两阶段恢复，等新进程启动时换库并跑迁移
  const dir = await backupDirPath();
  const src = await join(dir, chosen.name);
  const pendingPath = `${dbPath}${PENDING_RESTORE_SUFFIX}`;
  try {
    await remove(pendingPath);
  } catch {
    /* 覆盖旧 pending */
  }
  await copyFile(src, pendingPath);
  return "restart-required";
}

/** 用最新一份可用备份覆盖当前库（见 restoreCandidates 的版本语义） */
export async function restoreLatestBackup(): Promise<RestoreResult> {
  return withBackupLock(async () =>
    restoreCandidates((await listBackups()).map((b) => b.name)),
  );
}

/** 回退到最近一次"恢复前快照"（误恢复时的兜底入口） */
export async function restorePreRestoreSnapshot(): Promise<RestoreResult> {
  return withBackupLock(async () =>
    restoreCandidates(
      (await listPreRestoreSnapshots()).map((s) => s.name),
      false,
    ),
  );
}
