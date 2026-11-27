/** 金额格式化：cents → "1,234.56"（不带货币符号） */
export function formatMoney(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** 紧凑金额：整数位无小数、非整数保留两位。"1,234" / "1,234.50" */
export function formatMoneyCompact(cents: number, locale: string): string {
  const v = cents / 100;
  const hasFraction = cents % 100 !== 0;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(v);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** UTC 毫秒 → 本地日期 "YYYY-MM-DD" */
export function dateStrFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** UTC 毫秒 → 本地时间 "HH:MM" */
export function timeStrFromMs(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 本地 "YYYY-MM-DD" + "HH:MM" → UTC 毫秒（秒/毫秒为 0） */
export function localDateTimeToMs(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, min] = timeStr.split(":").map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

/** 本地日期当天 00:00 的 UTC 毫秒 */
export function startOfLocalDayMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** 本地日期次日 00:00 的 UTC 毫秒（作为日期范围的排他上界） */
export function nextLocalDayStartMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
}

/** 今天 → "YYYY-MM-DD"（本地时区） */
export function todayStr(): string {
  return dateStrFromMs(Date.now());
}

/** 现在时间 → "HH:MM"（本地时区） */
export function nowTimeStr(): string {
  return timeStrFromMs(Date.now());
}

/** "YYYY-MM-DD" → 星期几短名（按 locale） */
export function weekdayShort(dateStr: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
    new Date(`${dateStr}T00:00:00`),
  );
}

/** "2026-09" → "2026年9月" / "Sep 2026" */
export function yearMonthLabel(
  year: number,
  month: number,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
  }).format(new Date(year, month - 1, 1));
}

/** "2026-11-20" → "11月20日" / "Nov 20"（账目日头用） */
export function monthDayLabel(dateStr: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateStr}T00:00:00`));
}

/** 两个 "YYYY-MM-DD" 之间的整天数（含首尾），用于预算周期标尺 */
export function dateRangeDays(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime();
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

/**
 * 读取 CSS 语义 token 的当前值（供 ECharts 等非 Tailwind 场景取色）。
 * 主题切换后重新调用即可拿到新值。
 */
export function cssColor(token: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
}
