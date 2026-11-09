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

/** 今天 → "YYYY-MM-DD"（本地时区） */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 现在时间 → "HH:MM" */
export function nowTimeStr(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

/** 分类系统名的展示名：name_key 走 i18n，否则用存储名 */
export function categoryName(
  cat: { name: string; name_key: string | null },
  t: (key: string) => string,
): string {
  return cat.name_key ? t(cat.name_key) : cat.name;
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
