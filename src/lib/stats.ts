import { yearMonthLabel } from "./format";

export type StatsMode = "monthly" | "yearly";

export interface StatsQuery {
  mode: StatsMode;
  year: number;
  month: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 统计期间 → 本地日期起止（含首尾），与 Stats 数据查询口径一致 */
export function periodRange(
  mode: StatsMode,
  year: number,
  month: number,
): { from: string; to: string } {
  if (mode === "yearly") {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const last = new Date(year, month, 0).getDate();
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(last)}`,
  };
}

/** 解析类别页/明细页 query；非法值回退到当前月/年 */
export function parseStatsQuery(
  params: URLSearchParams,
  now = new Date(),
): StatsQuery {
  const mode: StatsMode =
    params.get("mode") === "yearly" ? "yearly" : "monthly";
  const rawYear = Number(params.get("year"));
  const rawMonth = Number(params.get("month"));
  const year =
    Number.isInteger(rawYear) && rawYear >= 1970 && rawYear <= 3000
      ? rawYear
      : now.getFullYear();
  const month =
    Number.isInteger(rawMonth) && rawMonth >= 1 && rawMonth <= 12
      ? rawMonth
      : now.getMonth() + 1;
  return { mode, year, month };
}

export function statsPeriodLabel(
  query: StatsQuery,
  locale: string,
): string {
  return query.mode === "yearly"
    ? String(query.year)
    : yearMonthLabel(query.year, query.month, locale);
}
