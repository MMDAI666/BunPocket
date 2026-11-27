import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAppBack } from "../hooks/useAppBack";
import { useAppNavigate } from "../hooks/useAppNavigate";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type { EChartsOption } from "echarts";
import type { BillKind, BillRow, Category, DateRange } from "../db";
import {
  billsInDateRange,
  budgetCycle,
  earliestBillDate,
  getBudgets,
  loadCategoryRows,
} from "../db";
import { buildCategoryTree, findCategory, rollupByNode, rollupByTopLevel } from "../lib/category";
import { periodRange } from "../lib/stats";
import {
  type BudgetRowMeta,
  annotateBudgetRows,
  budgetProgress,
  categoryBudgetRows,
  isOverBudget,
} from "../lib/budget";
import { cssColor, formatMoneyCompact } from "../lib/format";
import { errorMessage, logEvent } from "../lib/logger";
import { cn } from "../lib/cn";
import { getSetting } from "../settings";
import { Chart } from "../components/Chart";
import { Segmented } from "../components/ui/Segmented";
import { IconBadge } from "../components/ui/IconBadge";
import { ErrorState } from "../components/ui/ErrorState";
import { PageHeader } from "../components/ui/PageHeader";
import { useLocale } from "../hooks/useLocale";

/** ECharts 默认亮色盘：环形图与图例按同一顺序取色（"其他"片另用中性灰） */
const DONUT_PALETTE = [
  "#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de",
  "#3ba272", "#fc8452", "#9a60b4", "#ea7ccc",
];
/** "其他"扇区与图例统一使用的颜色（暗色下也保持一致） */
const OTHER_COLOR = "#8A918B";

interface StatsData {
  bills: BillRow[];
  roots: Category[];
}

interface StatsSnapshot {
  mode: "monthly" | "yearly";
  month: { y: number; m: number };
  year: number;
  shareKind: BillKind;
  drillIds: number[];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function Stats() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const goBack = useAppBack();
  const navigate = useAppNavigate();
  const location = useLocation();
  const saved = (location.state as { stats?: StatsSnapshot } | null)?.stats;
  const restoreDrillIds = useRef<number[] | null>(saved?.drillIds ?? null);

  const now = new Date();
  const [mode, setMode] = useState<"monthly" | "yearly">(
    saved?.mode ?? "monthly",
  );
  const [month, setMonth] = useState(
    saved?.month ?? { y: now.getFullYear(), m: now.getMonth() + 1 },
  );
  const [year, setYear] = useState(saved?.year ?? now.getFullYear());
  const [shareKind, setShareKind] = useState<BillKind>(
    saved?.shareKind ?? "expense",
  );
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
        const range = periodRange(
          mode,
          mode === "monthly" ? month.y : year,
          mode === "monthly" ? month.m : 1,
        );
        const from = range.from;
        const to = range.to;
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
      } catch (error) {
        if (!alive) return;
        void logEvent("error", "stats.load.failed", {
          mode,
          year: mode === "monthly" ? month.y : year,
          month: mode === "monthly" ? month.m : undefined,
          message: errorMessage(error),
        });
        setFailed(true);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode, month, year, reloadKey]);

  // 从类别页返回时按 id 恢复内联下钻路径；数据重查后再解析，避免缓存 Category 对象
  useEffect(() => {
    if (!data || restoreDrillIds.current === null) return;
    const ids = restoreDrillIds.current;
    restoreDrillIds.current = null;
    const path = ids
      .map((id) => findCategory(data.roots, id))
      .filter((cat): cat is Category => Boolean(cat));
    setDrillPath(path);
  }, [data]);

  const totals = useMemo(() => {
    let expense = 0;
    let income = 0;
    for (const b of data?.bills ?? []) {
      if (b.kind === "expense") expense += b.amount_cents;
      else income += b.amount_cents;
    }
    return { expense, income, net: income - expense };
  }, [data]);

  // 每日序列：趋势图固定同时算收支；月度下方统计仍按支出取
  const seriesByDay = useMemo(() => {
    const expense = new Map<string, number>();
    const income = new Map<string, number>();
    for (const b of data?.bills ?? []) {
      const map = b.kind === "expense" ? expense : income;
      map.set(b.date, (map.get(b.date) ?? 0) + b.amount_cents);
    }
    return { expense, income };
  }, [data]);

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
    const values = [...seriesByDay.expense.values()];
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

  const ink3 = useMemo(() => cssColor("--color-ink-3"), [themeRevision]);
  const lineColor = useMemo(() => cssColor("--color-line"), [themeRevision]);
  const dailyBarColor = useMemo(() => cssColor("--color-expense"), [themeRevision]);
  const chartFont =
    '"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  const axisCommon = useMemo(
    () => ({
      axisLine: { lineStyle: { color: lineColor } },
      axisTick: { show: false },
      axisLabel: { color: ink3, fontSize: 9, fontFamily: chartFont },
      splitLine: { lineStyle: { color: lineColor } },
    }),
    [ink3, lineColor],
  );
  const tooltipStyle = useMemo(
    () => ({
      backgroundColor: cssColor("--color-card"),
      borderColor: cssColor("--color-line"),
      borderWidth: 1,
      padding: [6, 9],
      textStyle: {
        color: cssColor("--color-ink"),
        fontSize: 11,
        fontFamily: chartFont,
      },
      extraCssText: "border-radius:8px;box-shadow:0 8px 20px -10px rgba(29,42,38,.18);",
    }),
    [themeRevision],
  );

  const dailyOption = useMemo<EChartsOption>(() => {
    const daysInMonth = new Date(month.y, month.m, 0).getDate();
    const dayLabels: string[] = [];
    const values: number[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${month.y}-${pad2(month.m)}-${pad2(d)}`;
      // 轴标签用 MM-DD（如 11-01），tooltip 头也沿用同一日期
      dayLabels.push(`${pad2(month.m)}-${pad2(d)}`);
      values.push((seriesByDay.expense.get(key) ?? 0) / 100);
    }
    return {
      grid: { left: 38, right: 6, top: 14, bottom: 22 },
      xAxis: {
        type: "category",
        data: dayLabels,
        ...axisCommon,
        // 31 个日期标签会挤在一起：每 5 天显示一个（约 6~7 个）
        axisLabel: { ...axisCommon.axisLabel, interval: 5 },
      },
      // 柱图去掉横向网格、只留基线；axisCommon 与月趋势共用，不能直接改
      yAxis: { type: "value", ...axisCommon, splitLine: { show: false } },
      tooltip: {
        trigger: "axis",
        ...tooltipStyle,
        valueFormatter: (v) =>
          `¥${formatMoneyCompact(Math.round(Number(v) * 100), locale)}`,
      },
      series: [
        {
          type: "bar",
          data: values,
          barMaxWidth: 6,
          itemStyle: {
            color: dailyBarColor,
            borderRadius: [3, 3, 0, 0],
          },
        },
      ],
    };
  }, [month, seriesByDay, axisCommon, locale, tooltipStyle, dailyBarColor]);

  const trendOption = useMemo<EChartsOption>(() => {
    const monthLabels = Array.from({ length: 12 }, (_, i) => `${i + 1}`);
    const expenseName = t("stats.expense");
    const incomeName = t("stats.income");
    const expenseColor = cssColor("--color-expense");
    const incomeColor = cssColor("--color-income");
    return {
      grid: { left: 38, right: 6, top: 18, bottom: 38 },
      xAxis: { type: "category", data: monthLabels, ...axisCommon },
      // 收入/支出固定共用同一 Y 轴，便于直接比较
      yAxis: { type: "value", ...axisCommon },
      tooltip: {
        trigger: "axis",
        ...tooltipStyle,
        valueFormatter: (v) =>
          `¥${formatMoneyCompact(Math.round(Number(v) * 100), locale)}`,
      },
      legend: {
        bottom: 0,
        itemWidth: 8,
        itemHeight: 8,
        icon: "circle",
        textStyle: { color: ink3, fontSize: 9 },
        data: [expenseName, incomeName],
        selectedMode: false,
      },
      series: [
        {
          name: expenseName,
          type: "line",
          smooth: true,
          data: monthlyTrend.expense.map((v) => v / 100),
          symbol: "circle",
          symbolSize: 5,
          lineStyle: { width: 2, color: expenseColor },
          itemStyle: { color: expenseColor },
          z: 2,
        },
        {
          name: incomeName,
          type: "line",
          smooth: true,
          data: monthlyTrend.income.map((v) => v / 100),
          symbol: "circle",
          symbolSize: 5,
          lineStyle: { width: 2, color: incomeColor },
          itemStyle: { color: incomeColor },
          z: 3,
        },
      ],
    };
  }, [
    monthlyTrend,
    axisCommon,
    ink3,
    t,
    locale,
    themeRevision,
    tooltipStyle,
  ]);

  const totalKindCents = shares.reduce((s, x) => s + x.cents, 0);
  const catName = (c: Category) => (c.name_key ? t(c.name_key) : c.name);
  const drillNode = drillPath[drillPath.length - 1] ?? null;
  const centerLabel = drillNode
    ? catName(drillNode)
    : shareKind === "expense"
      ? t("stats.totalExpense")
      : t("stats.totalIncome");
  const donutOption = useMemo<EChartsOption>(() => {
    const top = shares.slice(0, 5);
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
    // 第 6 名之后合并成"其他"一片，保证扇区之和 = 中心总额
    if (otherCents > 0) {
      data.push({
        name: t("stats.other"),
        value: otherCents / 100,
        itemStyle: { color: OTHER_COLOR },
      });
    }
    return {
      tooltip: {
        ...tooltipStyle,
        valueFormatter: (v) =>
          `¥${formatMoneyCompact(Math.round(Number(v) * 100), locale)}`,
      },
      series: [
        {
          type: "pie",
          radius: ["64%", "90%"],
          center: ["50%", "50%"],
          label: { show: false },
          itemStyle: {
            borderColor: cssColor("--color-card"),
            borderWidth: 2,
          },
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
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 20,
          },
        },
      ],
    };
  }, [
    shares,
    otherCents,
    totalKindCents,
    locale,
    centerLabel,
    t,
    themeRevision,
    tooltipStyle,
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

  const legend = shares.slice(0, 5);

  const goReport = () => {
    const snapshot: StatsSnapshot = {
      mode,
      month,
      year,
      shareKind,
      drillIds: drillPath.map((cat) => cat.id),
    };
    // 把 UI 快照写进当前 Stats 历史条目（不新增历史，也不与随后的 push 竞态），
    // 返回时 Stats 从 location.state 恢复，账单数据仍会重新查询。
    if (typeof window !== "undefined") {
      const current = (window.history.state ?? {}) as Record<string, unknown>;
      window.history.replaceState(
        { ...current, usr: { stats: snapshot } },
        "",
      );
    }
    const params = new URLSearchParams({
      mode,
      year: String(mode === "monthly" ? month.y : year),
      kind: shareKind,
    });
    if (mode === "monthly") params.set("month", String(month.m));
    const parent = drillPath[drillPath.length - 1];
    if (parent) params.set("parent", String(parent.id));
    navigate(`/stats/categories?${params.toString()}`);
  };

  return (
    <div className="flex h-full flex-col bg-page">
      <PageHeader title={t("nav.stats")} onBack={goBack} />

      <div className="px-3 pb-1 pt-1">
        <Segmented
          options={[
            { value: "monthly", label: t("stats.monthly") },
            { value: "yearly", label: t("stats.yearly") },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {/* 月份 / 年份横滑条 */}
        <div className="flex gap-1.5 overflow-x-auto py-2.5">
          {mode === "monthly"
            ? months.map((m) => (
                <button
                  key={`${m.y}-${m.m}`}
                  type="button"
                  className={cn(
                    "shrink-0 rounded-[8px] px-2.5 py-1 text-[11px] whitespace-nowrap transition-colors",
                    m.y === month.y && m.m === month.m
                      ? "bg-brand-soft font-medium text-brand"
                      : "text-ink-3 hover:bg-chip",
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
                    "shrink-0 rounded-[8px] px-2.5 py-1 text-[11px] transition-colors",
                    y === year
                      ? "bg-brand-soft font-medium text-brand"
                      : "text-ink-3 hover:bg-chip",
                  )}
                  onClick={() => setYear(y)}
                >
                  {y}
                </button>
              ))}
        </div>

        {/* 收支汇总（加载/失败时只保留外壳，避免展示假 0/旧周期数据） */}
        {failed ? (
          <div className="pt-1">
            <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
          </div>
        ) : loading ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">…</div>
        ) : (
          <>
            <div className="paper grid grid-cols-3 divide-x divide-line px-1 py-3.5">
              <SummaryCell
                label={t("stats.expense")}
                cents={totals.expense}
                locale={locale}
                tone="expense"
              />
              <SummaryCell
                label={t("stats.income")}
                cents={totals.income}
                locale={locale}
                tone="income"
              />
              <SummaryCell
                label={t("stats.net")}
                cents={totals.net}
                locale={locale}
                tone="net"
              />
            </div>

        {budgetExec && budgetExec.rows.length > 0 && (
          <section className="paper mt-3 p-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle text={t("stats.budgetExecutionCurrent")} />
              <span className="num text-[9px] text-ink-3">
                {t("budget.cycleRange", {
                  from: budgetExec.cycle.from,
                  to: budgetExec.cycle.to,
                })}
              </span>
            </div>
            <div className="mt-2.5 flex flex-col gap-2.5">
              {budgetExec.rows.map((row) => (
                <div key={row.cat.id}>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      {row.cat.name_key ? t(row.cat.name_key) : row.cat.name}
                      {row.hasBudgetedDescendant && (
                        <span className="ml-1 text-[9px] text-ink-3">
                          {t("budget.includesChildren")}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "num shrink-0",
                        isOverBudget(row) ? "text-expense" : "text-ink-3",
                      )}
                    >
                      {formatMoneyCompact(row.spent, locale)}
                      <span className="text-ink-3"> / </span>
                      {formatMoneyCompact(row.budget, locale)}
                    </span>
                  </div>
                  <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-chip">
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

        {/* 每日支出 / 月趋势 */}
        <section className="paper mt-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle
              text={
                mode === "monthly"
                  ? t("stats.dailyExpense")
                  : t("stats.monthlyTrend")
              }
            />
          </div>
          <div className="h-56">
            <Chart option={mode === "monthly" ? dailyOption : trendOption} />
          </div>
          {mode === "monthly" && dailyStats && (
            <div className="grid grid-cols-3 divide-x divide-line border-t border-line pt-3">
              <StatItem label={t("stats.maxDay")} value={dailyStats.max} locale={locale} />
              <StatItem label={t("stats.minDay")} value={dailyStats.min} locale={locale} />
              <StatItem label={t("stats.dailyAvg")} value={dailyStats.avg} locale={locale} />
            </div>
          )}
        </section>

        {/* 收支占比 */}
        <section className="paper mt-3 p-3">
          <div className="flex items-center justify-between gap-2">
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
            <div className="flex flex-wrap items-center gap-1 pt-1 text-[11px] text-ink-3">
              <button
                type="button"
                className="rounded-[6px] px-1 py-0.5 text-ink-2 transition-colors hover:bg-chip"
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
                      "rounded-[6px] px-1 py-0.5 transition-colors hover:bg-chip",
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
          <div className="flex items-center gap-1">
            <div className="h-40 w-40 shrink-0">
              <Chart option={donutOption} onEvents={donutEvents} />
            </div>
            <div className="ml-1 min-w-0 flex-1">
              {data !== null && shares.length === 0 ? (
                <div className="py-8 text-center text-[12px] text-ink-3">
                  {t("common.empty")}
                </div>
              ) : (
                <>
                  {legend.map((s, i) => (
                    <button
                      key={s.cat.id}
                      type="button"
                      className="flex w-full items-center rounded-[8px] py-1 text-left transition-colors hover:bg-chip/60 active:bg-chip"
                      onClick={() => drill(s.cat)}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length] }}
                      />
                      <div className="ml-1.5 flex min-w-0 flex-1 items-center gap-1.5">
                        <IconBadge
                          icon={s.cat.icon}
                          iconImage={s.cat.icon_image}
                          nameKey={s.cat.name_key}
                          iconType={s.cat.icon_type}
                          size="sm"
                          iconSize={13}
                          className="h-6 w-6 text-[11px]"
                        />
                        <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                          {catName(s.cat)}
                        </span>
                        <span
                          className={cn(
                            "num text-[11px]",
                            shareKind === "expense" ? "text-expense" : "text-income",
                          )}
                        >
                          {shareKind === "expense" ? "-" : "+"}
                          {formatMoneyCompact(s.cents, locale)}
                        </span>
                      </div>
                    </button>
                  ))}
                  {otherCents > 0 && (
                    <div className="flex items-center py-1">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: OTHER_COLOR }}
                      />
                      <div className="ml-1.5 flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                          {t("stats.other")}
                        </span>
                        <span
                          className={cn(
                            "num text-[11px]",
                            shareKind === "expense" ? "text-expense" : "text-income",
                          )}
                        >
                          {shareKind === "expense" ? "-" : "+"}
                          {formatMoneyCompact(otherCents, locale)}
                        </span>
                      </div>
                    </div>
                  )}
                  {shares.length > 0 && (
                    <button
                      type="button"
                      className="mt-0.5 flex items-center gap-0.5 text-[11px] text-brand"
                      onClick={goReport}
                    >
                      {t("stats.viewAll")}
                      <ChevronRight size={13} strokeWidth={1.9} />
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

function SummaryCell({
  label,
  cents,
  locale,
  tone,
}: {
  label: string;
  cents: number;
  locale: string;
  tone: "expense" | "income" | "net";
}) {
  return (
    <div className="min-w-0 px-3">
      <div className="text-[10px] text-ink-3">{label}</div>
      <div
        className={cn(
          "num mt-1 truncate text-[17px] font-semibold tracking-[-0.02em]",
          tone === "expense"
            ? "text-expense"
            : tone === "income"
              ? "text-income"
              : "text-net",
        )}
      >
        <span className="mr-0.5 text-[11px] font-medium text-ink-3">¥</span>
        {formatMoneyCompact(cents, locale)}
      </div>
    </div>
  );
}

function CardTitle({ text }: { text?: string }) {
  return <h2 className="text-[13px] font-semibold text-ink">{text}</h2>;
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
    <div className="min-w-0 px-1 text-center">
      <div className="num truncate text-[13px] font-semibold text-ink">
        ¥{formatMoneyCompact(value, locale)}
      </div>
      <div className="mt-0.5 text-[9px] text-ink-3">{label}</div>
    </div>
  );
}

