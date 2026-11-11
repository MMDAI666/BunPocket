import { useEffect, useMemo, useState } from "react";
import { useAppBack } from "../hooks/useAppBack";
import { useTranslation } from "react-i18next";
import type { EChartsOption } from "echarts";
import type { BillKind, BillRow, Category, DateRange } from "../db";
import {
  billsInDateRange,
  budgetCycle,
  earliestBillDate,
  getBudgets,
  loadCategoryRows,
} from "../db";
import { buildCategoryTree, rollupByNode, rollupByTopLevel } from "../lib/category";
import {
  type BudgetRowMeta,
  annotateBudgetRows,
  budgetProgress,
  categoryBudgetRows,
  isOverBudget,
} from "../lib/budget";
import { cssColor, formatMoneyCompact } from "../lib/format";
import { cn } from "../lib/cn";
import { getSetting } from "../settings";
import { Chart } from "../components/Chart";
import { Segmented } from "../components/ui/Segmented";
import { IconBadge } from "../components/ui/IconBadge";
import { ErrorState } from "../components/ui/ErrorState";
import { useLocale } from "../hooks/useLocale";

const DONUT_PALETTE = [
  "#8FB8F8", "#E8A23C", "#35C6E8", "#2FBF8F", "#F0C840",
  "#F07070", "#6C7BF0", "#E88BC0", "#98D861", "#B0A6F5",
  "#45B8AC", "#D98E5F", "#7FA65B", "#C77DB3", "#8C9BAB", "#5B8DC9",
];
/** "其他"扇区与图例统一使用的颜色（暗色下也保持一致） */
const OTHER_COLOR = "#9AA0A6";

interface StatsData {
  bills: BillRow[];
  roots: Category[];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function Stats() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const goBack = useAppBack();

  const now = new Date();
  const [mode, setMode] = useState<"monthly" | "yearly">("monthly");
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [year, setYear] = useState(now.getFullYear());
  const [dailyKind, setDailyKind] = useState<BillKind>("expense");
  const [shareKind, setShareKind] = useState<BillKind>("expense");
  const [showAll, setShowAll] = useState(false);
  const [drillPath, setDrillPath] = useState<Category[]>([]);
  const [data, setData] = useState<StatsData | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [budgetExec, setBudgetExec] = useState<{
    rows: BudgetRowMeta[];
    cycle: DateRange;
  } | null>(null);
  /** 最早账单日期：月份/年份选择器覆盖到账本起点，避免跨年后旧账不可达 */
  const [earliest, setEarliest] = useState<string | null>(null);
  /** 主题切换时重建图表 option（ECharts 颜色取自 CSS token，不会随 class 自动更新） */
  const [themeRevision, setThemeRevision] = useState(0);

  useEffect(() => {
    let alive = true;
    void earliestBillDate()
      .then((date) => {
        if (alive) setEarliest(date);
      })
      .catch(() => {
        /* 忽略：回退到默认 6 个月 */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeRevision((v) => v + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const months = useMemo(() => {
    const list: { y: number; m: number }[] = [];
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    const first = earliest ? new Date(`${earliest}T00:00:00`) : null;
    const minY = first?.getFullYear() ?? now.getFullYear();
    const minM = first?.getMonth() ?? now.getMonth();
    // 上限 120 个月，防止异常数据把选择器撑爆
    for (let i = 0; i < 120; i++) {
      list.push({ y: d.getFullYear(), m: d.getMonth() + 1 });
      if (d.getFullYear() === minY && d.getMonth() === minM) break;
      d.setMonth(d.getMonth() - 1);
      if (d.getFullYear() < minY || (d.getFullYear() === minY && d.getMonth() < minM)) {
        break;
      }
    }
    return list;
    // now 在组件生命周期内不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earliest]);

  const years = useMemo(() => {
    const firstYear = earliest
      ? new Date(`${earliest}T00:00:00`).getFullYear()
      : now.getFullYear();
    const start = Math.min(firstYear, now.getFullYear());
    return Array.from(
      { length: Math.min(now.getFullYear() - start + 1, 30) },
      (_, i) => now.getFullYear() - i,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earliest]);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setLoading(true);
    (async () => {
      try {
        let from: string;
        let to: string;
        if (mode === "monthly") {
          const last = new Date(month.y, month.m, 0).getDate();
          from = `${month.y}-${pad2(month.m)}-01`;
          to = `${month.y}-${pad2(month.m)}-${pad2(last)}`;
        } else {
          from = `${year}-01-01`;
          to = `${year}-12-31`;
        }
        const day = Math.min(
          Math.max(Number((await getSetting("billing_day")) ?? "1") || 1, 1),
          28,
        );
        const cycle = budgetCycle(day);
        const [bills, rows, cycleBills, budgets] = await Promise.all([
          billsInDateRange(from, to),
          loadCategoryRows(),
          billsInDateRange(cycle.from, cycle.to),
          getBudgets(),
        ]);
        if (!alive) return;
        const roots = buildCategoryTree(rows);
        const expenseRoots = roots.filter((cat) => cat.kind === "expense");
        setData({ bills, roots });
        setBudgetExec({
          rows: annotateBudgetRows(
            categoryBudgetRows(expenseRoots, budgets.byCategory, cycleBills),
          )
            .filter((row) => row.budget > 0)
            .sort((a, b) => b.spent / b.budget - a.spent / a.budget),
          cycle,
        });
        setLoading(false);
      } catch {
        if (!alive) return;
        setFailed(true);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode, month, year, reloadKey]);

  const totals = useMemo(() => {
    let expense = 0;
    let income = 0;
    for (const b of data?.bills ?? []) {
      if (b.kind === "expense") expense += b.amount_cents;
      else income += b.amount_cents;
    }
    return { expense, income, net: income - expense };
  }, [data]);

  // 每日 / 每月 序列（按当前 kind）
  const seriesByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of data?.bills ?? []) {
      if (b.kind !== dailyKind) continue;
      map.set(b.date, (map.get(b.date) ?? 0) + b.amount_cents);
    }
    return map;
  }, [data, dailyKind]);

  const monthlyTrend = useMemo(() => {
    const expense = new Array(12).fill(0);
    const income = new Array(12).fill(0);
    for (const b of data?.bills ?? []) {
      const m = Number(b.date.slice(5, 7)) - 1;
      if (b.kind === "expense") expense[m] += b.amount_cents;
      else income[m] += b.amount_cents;
    }
    return { expense, income };
  }, [data]);

  const shares = useMemo(() => {
    const node = drillPath[drillPath.length - 1] ?? null;
    if (node) return rollupByNode(data?.bills ?? [], node, shareKind);
    const sums = rollupByTopLevel(data?.bills ?? [], data?.roots ?? [], shareKind);
    const rootById = new Map((data?.roots ?? []).map((r) => [r.id, r]));
    return [...sums.entries()]
      .map(([id, cents]) => ({ cat: rootById.get(id), cents }))
      .filter((s): s is { cat: Category; cents: number } => Boolean(s.cat))
      .sort((a, b) => b.cents - a.cents);
  }, [data, shareKind, drillPath]);

  const otherCents = useMemo(
    () => shares.slice(5).reduce((sum, s) => sum + s.cents, 0),
    [shares],
  );

  const dailyStats = useMemo(() => {
    if (mode !== "monthly") return null;
    const values = [...seriesByDay.values()];
    if (values.length === 0) return null;
    const total = values.reduce((s, v) => s + v, 0);
    const daysInMonth = new Date(month.y, month.m, 0).getDate();
    return {
      max: Math.max(...values),
      // 与"日均按自然日"口径一致：当月存在没记账的日期时，最低日支出就是 0
      min: values.length < daysInMonth ? 0 : Math.min(...values),
      // 自然日口径：总额 / 当月天数（不是"有记账的天数"）
      avg: Math.round(total / daysInMonth),
    };
  }, [seriesByDay, mode, month]);

  const yearlyStats = useMemo(() => {
    if (mode !== "yearly") return null;
    const series = monthlyTrend[dailyKind === "expense" ? "expense" : "income"];
    const total = series.reduce((sum, v) => sum + v, 0);
    const nonZero = series.filter((v) => v > 0);
    if (nonZero.length === 0) return null;
    return {
      max: Math.max(...nonZero),
      // 与月度一致：年内存在没记账的月份时，最低月为 0
      min: nonZero.length < 12 ? 0 : Math.min(...nonZero),
      avg: Math.round(total / 12),
    };
  }, [monthlyTrend, mode, dailyKind]);

  const ink3 = useMemo(() => cssColor("--color-ink-3"), [themeRevision]);
  const lineColor = useMemo(() => cssColor("--color-line"), [themeRevision]);
  const axisCommon = useMemo(
    () => ({
      axisLine: { lineStyle: { color: lineColor } },
      axisLabel: { color: ink3, fontSize: 10 },
      splitLine: { lineStyle: { color: lineColor } },
    }),
    [ink3, lineColor],
  );

  const dailyOption = useMemo<EChartsOption>(() => {
    const daysInMonth = new Date(month.y, month.m, 0).getDate();
    const dayLabels: string[] = [];
    const values: number[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${month.y}-${pad2(month.m)}-${pad2(d)}`;
      dayLabels.push(pad2(d));
      values.push((seriesByDay.get(key) ?? 0) / 100);
    }
    return {
      grid: { left: 44, right: 8, top: 16, bottom: 24 },
      xAxis: { type: "category", data: dayLabels, ...axisCommon },
      yAxis: { type: "value", ...axisCommon },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) => `¥${formatMoneyCompact(Math.round(Number(v) * 100), locale)}`,
      },
      series: [
        {
          type: "bar",
          data: values,
          barMaxWidth: 10,
          itemStyle: {
            color: cssColor(dailyKind === "expense" ? "--color-expense" : "--color-income"),
            borderRadius: [3, 3, 0, 0],
          },
        },
      ],
    };
  }, [month, seriesByDay, dailyKind, axisCommon, locale]);

  const trendOption = useMemo<EChartsOption>(() => {
    const kindName =
      dailyKind === "expense" ? t("stats.expense") : t("stats.income");
    const color = cssColor(
      dailyKind === "expense" ? "--color-expense" : "--color-income",
    );
    const monthLabels = Array.from({ length: 12 }, (_, i) => `${i + 1}`);
    return {
      grid: { left: 44, right: 8, top: 24, bottom: 24 },
      xAxis: { type: "category", data: monthLabels, ...axisCommon },
      yAxis: { type: "value", ...axisCommon },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) => `¥${formatMoneyCompact(Math.round(Number(v) * 100), locale)}`,
      },
      legend: {
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: ink3, fontSize: 10 },
        data: [kindName],
      },
      series: [
        {
          name: kindName,
          type: "line",
          smooth: true,
          data: monthlyTrend[dailyKind].map((v) => v / 100),
          symbol: "circle",
          symbolSize: 5,
          lineStyle: { width: 2, color },
          itemStyle: { color },
        },
      ],
    };
  }, [monthlyTrend, axisCommon, ink3, t, dailyKind, locale]);

  const totalKindCents = shares.reduce((s, x) => s + x.cents, 0);
  const catName = (c: Category) => (c.name_key ? t(c.name_key) : c.name);
  const drillNode = drillPath[drillPath.length - 1] ?? null;
  const centerLabel = drillNode
    ? catName(drillNode)
    : shareKind === "expense"
      ? t("stats.totalExpense")
      : t("stats.totalIncome");
  const donutOption = useMemo<EChartsOption>(() => {
    const top = showAll ? shares : shares.slice(0, 5);
    const data: {
      name: string;
      value: number;
      catId?: number;
      itemStyle: { color: string };
    }[] = top.map((s, i) => ({
      name: catName(s.cat),
      value: s.cents / 100,
      catId: s.cat.id,
      itemStyle: { color: DONUT_PALETTE[i % DONUT_PALETTE.length] },
    }));
    // 折叠状态把第 6 名之后的分类合并成"其他"一片，保证扇区之和 = 中心总额
    if (!showAll && otherCents > 0) {
      data.push({
        name: t("stats.other"),
        value: otherCents / 100,
        itemStyle: { color: OTHER_COLOR },
      });
    }
    return {
      tooltip: { valueFormatter: (v) => `¥${v}` },
      series: [
        {
          type: "pie",
          radius: ["62%", "88%"],
          center: ["50%", "50%"],
          label: { show: false },
          animationDuration: 600,
          animationDurationUpdate: 300,
          animationType: "expansion",
          data,
        },
      ],
      graphic: [
        {
          type: "text",
          left: "center",
          top: "middle",
          style: {
            text: `${formatMoneyCompact(totalKindCents, locale)}\n${centerLabel}`,
            textAlign: "center",
            fill: cssColor("--color-ink"),
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 18,
          },
        },
      ],
    };
  }, [
    shares,
    showAll,
    otherCents,
    totalKindCents,
    locale,
    centerLabel,
    t,
    themeRevision,
  ]);

  /** 单击下钻：仅带未隐藏子分类的分类可下钻；下钻层的"本级"桶（自身）不可再进 */
  const drill = (cat: Category) => {
    const current = drillPath[drillPath.length - 1];
    if (current?.id === cat.id) return;
    if (!cat.children.some((c) => !c.hidden)) return;
    setDrillPath((p) => [...p, cat]);
  };

  const donutEvents = useMemo(
    () => ({
      click: (params: unknown) => {
        const catId = (params as { data?: { catId?: number } })?.data?.catId;
        const entry = catId == null ? undefined : shares.find((s) => s.cat.id === catId);
        if (entry) drill(entry.cat);
      },
    }),
    // drill 闭包捕获 drillPath/t，相关变化时重建（Chart 内经 ref 转发，重建不重绑事件）
    [shares, drillPath, t],
  );

  const legend = showAll ? shares : shares.slice(0, 5);

  return (
    <div className="flex h-full flex-col bg-page">
      {/* 顶栏 */}
      <div className="flex items-center px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-1">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-ink active:bg-chip"
          onClick={goBack}
          aria-label={t("common.back")}
        >
          ‹
        </button>
        <div className="flex flex-1 justify-center">
          <Segmented
            block={false}
            options={[
              { value: "monthly", label: t("stats.monthly") },
              { value: "yearly", label: t("stats.yearly") },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
        <div className="w-10" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {/* 月份 / 年份横滑条 */}
        <div className="flex gap-2 overflow-x-auto py-2">
          {mode === "monthly"
            ? months.map((m) => (
                <button
                  key={`${m.y}-${m.m}`}
                  type="button"
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 text-xs whitespace-nowrap",
                    m.y === month.y && m.m === month.m
                      ? "bg-chip font-semibold text-brand"
                      : "text-ink-3",
                  )}
                  onClick={() => setMonth(m)}
                >
                  {String(m.y).slice(2)}-{pad2(m.m)}
                </button>
              ))
            : years.map((y) => (
                <button
                  key={y}
                  type="button"
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 text-xs",
                    y === year ? "bg-chip font-semibold text-brand" : "text-ink-3",
                  )}
                  onClick={() => setYear(y)}
                >
                  {y}
                </button>
              ))}
        </div>

        {/* 收支汇总横幅（加载/失败时只保留外壳，避免展示假 0/旧周期数据） */}
        {failed ? (
          <div className="pt-2">
            <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
          </div>
        ) : loading ? (
          <div className="py-10 text-center text-sm text-ink-3">…</div>
        ) : (
          <>
        <div className="grid grid-cols-3 rounded-2xl bg-gradient-to-r from-brand-1 to-brand-2 p-4 text-white">
          <div>
            <div className="text-xs text-white/80">{t("stats.expense")}(¥)</div>
            <div className="mt-1 truncate text-lg font-medium">
              {formatMoneyCompact(totals.expense, locale)}
            </div>
          </div>
          <div>
            <div className="text-xs text-white/80">{t("stats.income")}(¥)</div>
            <div className="mt-1 truncate text-lg font-medium">
              {formatMoneyCompact(totals.income, locale)}
            </div>
          </div>
          <div>
            <div className="text-xs text-white/80">{t("stats.net")}(¥)</div>
            <div className="mt-1 truncate text-lg font-medium">
              {formatMoneyCompact(totals.net, locale)}
            </div>
          </div>
        </div>

        {budgetExec && budgetExec.rows.length > 0 && (
          <section className="mt-3 rounded-2xl bg-card p-3">
            <div className="flex items-center justify-between">
              <CardTitle text={t("stats.budgetExecutionCurrent")} />
              <span className="text-[10px] text-ink-3">
                {t("budget.cycleRange", {
                  from: budgetExec.cycle.from,
                  to: budgetExec.cycle.to,
                })}
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-2.5">
              {budgetExec.rows.map((row) => (
                <div key={row.cat.id}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      {row.cat.name_key ? t(row.cat.name_key) : row.cat.name}
                      {row.hasBudgetedDescendant && (
                        <span className="ml-1 text-[10px] text-ink-3">
                          {t("budget.includesChildren")}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "shrink-0",
                        isOverBudget(row) ? "text-expense" : "text-ink-3",
                      )}
                    >
                      {formatMoneyCompact(row.spent, locale)} / ¥
                      {formatMoneyCompact(row.budget, locale)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-chip">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        isOverBudget(row) ? "bg-expense" : "bg-brand",
                      )}
                      style={{
                        width: `${Math.round(budgetProgress(row) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 每日收支 / 月趋势 */}
        <section className="mt-3 rounded-2xl bg-card p-3">
          <div className="flex items-center justify-between">
            <CardTitle
              text={mode === "monthly" ? t("stats.dailyFlow") : t("stats.monthlyTrend")}
            />
            <Segmented
              size="sm"
              block={false}
              options={[
                { value: "expense", label: t("stats.expense") },
                { value: "income", label: t("stats.income") },
              ]}
              value={dailyKind}
              onChange={setDailyKind}
            />
          </div>
          <div className="h-56">
            <Chart option={mode === "monthly" ? dailyOption : trendOption} />
          </div>
          {mode === "monthly" && dailyStats && (
            <div className="grid grid-cols-3 pt-2">
              <StatItem label={t("stats.maxDay")} value={dailyStats.max} locale={locale} />
              <StatItem label={t("stats.minDay")} value={dailyStats.min} locale={locale} />
              <StatItem label={t("stats.dailyAvg")} value={dailyStats.avg} locale={locale} />
            </div>
          )}
          {mode === "yearly" && yearlyStats && (
            <div className="grid grid-cols-3 pt-2">
              <StatItem label={t("stats.maxMonth")} value={yearlyStats.max} locale={locale} />
              <StatItem label={t("stats.minMonth")} value={yearlyStats.min} locale={locale} />
              <StatItem label={t("stats.monthlyAvg")} value={yearlyStats.avg} locale={locale} />
            </div>
          )}
          {mode === "yearly" && (
            <div className="pt-1 text-right text-[10px] text-ink-3">
              {t("stats.calendarMonths")}
            </div>
          )}
        </section>

        {/* 收支占比 */}
        <section className="mt-3 rounded-2xl bg-card p-3">
          <div className="flex items-center justify-between">
            <CardTitle text={t("stats.categoryShare")} />
            <Segmented
              size="sm"
              block={false}
              options={[
                { value: "expense", label: t("stats.expense") },
                { value: "income", label: t("stats.income") },
              ]}
              value={shareKind}
              onChange={(v) => {
                setShareKind(v);
                setDrillPath([]);
              }}
            />
          </div>
          {drillPath.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pb-1 text-xs text-ink-3">
              <button
                type="button"
                className="rounded px-1 py-0.5 text-ink-2 active:bg-chip"
                onClick={() => setDrillPath([])}
              >
                {t("stats.all")}
              </button>
              {drillPath.map((node, i) => (
                <span key={node.id} className="flex items-center gap-1">
                  <span>›</span>
                  <button
                    type="button"
                    className={cn(
                      "rounded px-1 py-0.5 active:bg-chip",
                      i === drillPath.length - 1 ? "font-medium text-ink" : "text-ink-2",
                    )}
                    onClick={() => setDrillPath(drillPath.slice(0, i + 1))}
                  >
                    {catName(node)}
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center">
            <div className="h-44 w-44 shrink-0">
              <Chart option={donutOption} onEvents={donutEvents} />
            </div>
            <div className="ml-2 min-w-0 flex-1">
              {data !== null && shares.length === 0 ? (
                <div className="py-8 text-center text-sm text-ink-3">
                  {t("common.empty")}
                </div>
              ) : (
                <>
                  {legend.map((s, i) => (
                    <button
                      key={s.cat.id}
                      type="button"
                      className="flex w-full items-center rounded-lg py-1 text-left active:bg-chip"
                      onClick={() => drill(s.cat)}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length] }}
                      />
                      <div className="ml-2 flex min-w-0 flex-1 items-center gap-2">
                        <IconBadge icon={s.cat.icon} iconImage={s.cat.icon_image} nameKey={s.cat.name_key} iconType={s.cat.icon_type} size="sm" iconSize={16} className="h-6 w-6 text-sm" />
                        <span className="min-w-0 flex-1 truncate text-xs text-ink">
                          {catName(s.cat)}
                        </span>
                        <span className={cn("text-xs", shareKind === "expense" ? "text-expense" : "text-income")}>
                          {shareKind === "expense" ? "-" : "+"}
                          {formatMoneyCompact(s.cents, locale)}
                        </span>
                        <span className="w-9 text-right text-[10px] text-ink-3">
                          {totalKindCents > 0
                            ? `${Math.round((s.cents / totalKindCents) * 100)}%`
                            : "0%"}
                        </span>
                      </div>
                    </button>
                  ))}
                  {!showAll && otherCents > 0 && (
                    <div className="flex items-center py-1">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: OTHER_COLOR }}
                      />
                      <div className="ml-2 flex min-w-0 flex-1 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-ink">
                          {t("stats.other")}
                        </span>
                        <span className={cn("text-xs", shareKind === "expense" ? "text-expense" : "text-income")}>
                          {shareKind === "expense" ? "-" : "+"}
                          {formatMoneyCompact(otherCents, locale)}
                        </span>
                        <span className="w-9 text-right text-[10px] text-ink-3">
                          {totalKindCents > 0
                            ? `${Math.round((otherCents / totalKindCents) * 100)}%`
                            : "0%"}
                        </span>
                      </div>
                    </div>
                  )}
                  {shares.length > 5 && (
                    <button
                      type="button"
                      className="pt-1 text-xs text-brand"
                      onClick={() => setShowAll((v) => !v)}
                    >
                      {showAll ? "﹀" : "›"}{" "}
                      {showAll ? t("stats.collapse") : t("stats.viewAll")}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
          </>
        )}
      </div>
    </div>
  );
}

function CardTitle({ text }: { text?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-4 w-4">
        <div className="absolute top-0 left-0 h-2.5 w-2.5 rounded-[3px] bg-brand-1" />
        <div className="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-[3px] bg-brand-2" />
      </div>
      <h2 className="text-sm font-bold text-ink">{text}</h2>
    </div>
  );
}

function StatItem({
  label,
  value,
  locale,
}: {
  label: string;
  value: number;
  locale: string;
}) {
  return (
    <div className="text-center">
      <div className="text-sm font-bold text-ink">
        {formatMoneyCompact(value, locale)}
      </div>
      <div className="mt-0.5 text-[10px] text-ink-3">{label}</div>
    </div>
  );
}

