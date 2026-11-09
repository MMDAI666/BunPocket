import { appConfigDir, join } from "@tauri-apps/api/path";
import { copyFile, mkdir, readDir, remove, rename } from "@tauri-apps/plugin-fs";
import { closeDb, getDb } from "../db";
import { getSetting, setSetting } from "../settings";
import { todayStr } from "./format";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const BACKUP_DIR = "backups";
const BACKUP_PREFIX = "bunpocket-";
const DEFAULT_KEEP = 1;
const MAX_KEEP = 30;

export interface BackupInfo {
  name: string;
  date: Date;
}

async function backupDirPath(): Promise<string> {
  const base = await appConfigDir();
  if (!base) throw new Error("appConfigDir unavailable");
  return join(base, BACKUP_DIR);
}

function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${BACKUP_PREFIX}${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.db`;
}

function parseBackupName(name: string): Date | null {
  const m = name.match(
    /^bunpocket-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/,
  );
  if (!m) return null;
  return new Date(
    +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6],
  );
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
    .filter((e) => e.isFile && e.name.startsWith(BACKUP_PREFIX) && e.name.endsWith(".db"))
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

/** VACUUM INTO 原子快照：连接池打开时也安全，目标已存在会报错（文件名带秒级时间戳避免） */
async function createBackup(): Promise<BackupInfo> {
  if (!isTauri) throw new Error("fs unavailable");
  const dir = await backupDirPath();
  await mkdir(dir, { recursive: true });
  const name = backupFileName();
  const target = await join(dir, name);
  const db = await getDb();
  await db.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return { name, date: new Date() };
}

async function rotateBackups(keep: number): Promise<void> {
  const backups = await listBackups();
  const dir = await backupDirPath();
  for (const old of backups.slice(keep)) {
    await remove(await join(dir, old.name));
  }
}

/** 手动立即备份（设置页按钮）：备份 + 轮转 */
export async function backupNow(): Promise<BackupInfo> {
  const info = await createBackup();
  await setSetting("last_backup_at", info.date.toISOString());
  await rotateBackups(await getKeepCount());
  return info;
}

/** 每天首次连库时调用：当天已有备份（含手动）则只补标记 */
export async function ensureDailyBackup(): Promise<void> {
  if (!isTauri) return;
  try {
    const today = todayStr();
    if ((await getSetting("last_backup_date")) === today) return;

    const newest = (await listBackups())[0];
    const d = newest?.date;
    const newestDay = d
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      : "";
    if (newestDay !== today) {
      await createBackup();
    }
    await setSetting("last_backup_date", today);
    await setSetting("last_backup_at", new Date().toISOString());
    await rotateBackups(await getKeepCount());
  } catch (e) {
    console.warn("daily backup failed:", e);
  }
}

/** 用最新备份覆盖当前库：先落 tmp 再原子换名，任何一步失败都保留原库可回退 */
export async function restoreLatestBackup(): Promise<void> {
  if (!isTauri) throw new Error("fs unavailable");
  const backups = await listBackups();
  if (backups.length === 0) throw new Error("no backup available");

  const base = await appConfigDir();
  if (!base) throw new Error("appConfigDir unavailable");
  const src = await join(await backupDirPath(), backups[0].name);
  const dbPath = await join(base, "bunpocket.db");
  const tmpPath = `${dbPath}-restore-tmp`;
  const oldPath = `${dbPath}.old`;

  await copyFile(src, tmpPath);
  await closeDb();

  try {
    await remove(oldPath);
  } catch {
    /* 无旧档 */
  }
  try {
    await rename(dbPath, oldPath);
  } catch {
    /* 库文件可能不存在（首次运行即恢复） */
  }
  for (const suffix of ["-wal", "-shm"]) {
    try {
      await remove(`${dbPath}${suffix}`);
    } catch {
      /* 无 wal 残留 */
    }
  }
  try {
    await rename(tmpPath, dbPath);
  } catch (e) {
    try {
      await rename(oldPath, dbPath);
    } catch {
      /* 尽力回滚 */
    }
    throw e;
  }
  try {
    await remove(oldPath);
  } catch {
    /* 清理失败不影响恢复结果 */
  }
  location.reload();
}
