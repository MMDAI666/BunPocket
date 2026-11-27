import { getVersion } from "@tauri-apps/api/app";
import { appConfigDir, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { billsSummary, schemaVersion } from "../db";
import { getSetting, setSetting } from "../settings";

/**
 * 运行日志：按天滚动写到 $APPCONFIG/logs/bunpocket-YYYYMMDD.log。
 *
 * 特意放在主库之外：恢复备份会整库换文件，如果日志存在 SQLite 里，
 * 恰恰在最需要排查"数据怎么没了"的时候会一起被换掉。
 * 日志写入永远不向业务抛错；保留天数走 settings（默认 7 天）。
 */

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const LOG_DIR = "logs";
const FILE_PREFIX = "bunpocket-";
const FILE_SUFFIX = ".log";
const SETTING_KEY = "log_keep_days";
const MAX_READ_LINES = 500;

export const LOG_KEEP_DEFAULT = 7;
export const LOG_KEEP_MIN = 1;
export const LOG_KEEP_MAX = 30;
/** 设置页滚轮可选项 */
export const LOG_KEEP_OPTIONS = Array.from(
  { length: LOG_KEEP_MAX },
  (_, index) => index + LOG_KEEP_MIN,
);

type LogLevel = "info" | "warn" | "error";

let dirPromise: Promise<string> | null = null;
/** 串行写同一文件，避免并发 append 交错 */
let writeChain: Promise<void> = Promise.resolve();

const pad2 = (value: number) => String(value).padStart(2, "0");

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function fileNameFor(date: Date): string {
  return `${FILE_PREFIX}${dateKey(date)}${FILE_SUFFIX}`;
}

function tzOffset(date = new Date()): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

function stamp(date = new Date()): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.` +
    `${String(date.getMilliseconds()).padStart(3, "0")} ${tzOffset(date)}`
  );
}

function detailJson(detail?: Record<string, unknown>): string {
  if (!detail) return "";
  try {
    return ` ${JSON.stringify(detail)}`;
  } catch {
    return " {}";
  }
}

async function logDir(): Promise<string> {
  if (!dirPromise) {
    dirPromise = (async () => {
      const base = await appConfigDir();
      if (!base) throw new Error("appConfigDir unavailable");
      const dir = await join(base, LOG_DIR);
      if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
      }
      return dir;
    })().catch((error) => {
      dirPromise = null;
      throw error;
    });
  }
  return dirPromise;
}

/** 追加一条日志；失败静默（日志不能影响记账）。返回可等待的写入完成 Promise */
export function logEvent(
  level: LogLevel,
  event: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!isTauri || !event) return Promise.resolve();
  const now = new Date();
  const line = `${stamp(now)} [${level}] ${event}${detailJson(detail)}\n`;
  const task = async () => {
    try {
      const dir = await logDir();
      await writeTextFile(await join(dir, fileNameFor(now)), line, {
        append: true,
      });
    } catch {
      /* 日志目录不可写时忽略 */
    }
  };
  writeChain = writeChain.then(task, task);
  return writeChain;
}

interface LogFile {
  name: string;
  date: Date;
}

function parseLogFileName(name: string): Date | null {
  const match = name.match(
    /^bunpocket-(\d{4})(\d{2})(\d{2})\.log$/,
  );
  if (!match) return null;
  return new Date(+match[1], +match[2] - 1, +match[3]);
}

async function listLogFiles(): Promise<LogFile[]> {
  if (!isTauri) return [];
  try {
    const dir = await logDir();
    const entries = await readDir(dir);
    return entries
      .filter((entry) => entry.isFile)
      .map((entry) => {
        const date = parseLogFileName(entry.name);
        return date ? { name: entry.name, date } : null;
      })
      .filter((file): file is LogFile => file !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function clampKeepDays(days: number): number {
  if (!Number.isFinite(days)) return LOG_KEEP_DEFAULT;
  return Math.min(Math.max(Math.round(days), LOG_KEEP_MIN), LOG_KEEP_MAX);
}

export async function getLogKeepDays(): Promise<number> {
  try {
    const raw = await getSetting(SETTING_KEY);
    if (raw == null || raw.trim() === "") return LOG_KEEP_DEFAULT;
    return clampKeepDays(Number(raw));
  } catch {
    return LOG_KEEP_DEFAULT;
  }
}

/** 删除早于"今天 - (keepDays-1)"的日志文件 */
export async function pruneLogs(keepDays: number): Promise<void> {
  if (!isTauri) return;
  await writeChain.catch(() => {
    /* 等挂起的写入落盘，避免删到正在写的文件 */
  });
  const keep = clampKeepDays(keepDays);
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (keep - 1));
  const dir = await logDir();
  for (const file of await listLogFiles()) {
    if (file.date < cutoff) {
      try {
        await remove(await join(dir, file.name));
      } catch {
        /* 单个文件删不掉不影响其余清理 */
      }
    }
  }
}

export async function setLogKeepDays(days: number): Promise<void> {
  const value = clampKeepDays(days);
  await setSetting(SETTING_KEY, String(value));
  await pruneLogs(value).catch(() => {
    /* IO 失败不影响设置本身 */
  });
  await logEvent("info", "log.retention", { days: value });
}

/** 读取保留期内最近 maxLines 行（最旧 → 最新），供设置页查看 */
export async function readLogs(maxLines = MAX_READ_LINES): Promise<string> {
  if (!isTauri) return "";
  await writeChain.catch(() => {
    /* 等挂起的写入落盘，读到完整行 */
  });
  const dir = await logDir();
  const lines: string[] = [];
  for (const file of await listLogFiles()) {
    try {
      const text = await readTextFile(await join(dir, file.name));
      lines.push(...text.split(/\r?\n/).filter((line) => line !== ""));
    } catch {
      /* 跳过损坏/不可读的单个文件 */
    }
  }
  return lines.slice(-maxLines).join("\n");
}

export async function clearLogs(): Promise<void> {
  if (!isTauri) return;
  await writeChain.catch(() => {
    /* 等挂起的写入落盘，避免清空后又冒出新行 */
  });
  const dir = await logDir();
  for (const file of await listLogFiles()) {
    try {
      await remove(await join(dir, file.name));
    } catch {
      /* 清理失败留给用户重试 */
    }
  }
}

/**
 * 启动时初始化：按配置清理旧日志，然后记录一条启动快照。
 * 快照包含总笔数、最早/最晚日期和最近 8 天每日笔数——
 * 下次再怀疑"某天数据没了"时，可以对照前一天启动快照。
 */
export async function startLogging(): Promise<void> {
  if (!isTauri) return;
  const keep = await getLogKeepDays();
  await pruneLogs(keep).catch(() => {
    /* 清理失败不阻塞启动 */
  });
  try {
    const version = await getVersion().catch(() => null);
    const [schema, summary] = await Promise.all([
      schemaVersion(),
      billsSummary(8),
    ]);
    const days: Record<string, number> = {};
    for (const day of summary.recentDays) days[day.date] = day.count;
    await logEvent("info", "app.start", {
      version,
      schema,
      bills: summary.count,
      first: summary.firstDate,
      last: summary.lastDate,
      tz: tzOffset(),
      days,
    });
  } catch (error) {
    await logEvent("warn", "app.start.summaryFailed", {
      message: errorMessage(error),
    });
  }
}
