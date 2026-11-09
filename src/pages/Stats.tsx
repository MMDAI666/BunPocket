import { useEffect, useMemo, useState } from "react";
import { useAppBack } from "../hooks/useAppBack";
import { useTranslation } from "react-i18next";
import * as echarts from "echarts";
import type { BillKind, BillRow, Category } from "../db";
import { billsInDateRange, loadCategoryRows } from "../db";
import { buildCategoryTree, rollupByNode, rollupByTopLevel } from "../lib/category";
import { cssColor, formatMoneyCompact } from "../lib/format";
import { cn } from "../lib/cn";
import { Chart } from "../components/Chart";
import { Segmented } from "../components/ui/Segmented";
import { IconBadge } from "../components/ui/IconBadge";
import { useLocale } from "../hooks/useLocale";

const DONUT_PALETTE = [
  "#8FB8F8", "#E8A23C", "#35C6E8", "#2FBF8F", "#F0C840",
  "#F07070", "#6C7BF0", "#E88BC0", "#98D861", "#B0A6F5",
];

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

  const months = useMemo(() => {
    const list: { y: number; m: number }[] = [];
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 6; i++) {
      list.push({ y: d.getFullYear(), m: d.getMonth() + 1 });
      d.setMonth(d.getMonth() - 1);
    }
    return list;
  }, []);
  const years = useMemo(
    () => Array.from({ length: 6 }, (_, i) => now.getFullYear() - i),
    [],
  );

  useEffect(() => {
    let alive = true;
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
        const [bills, rows] = await Promise.all([
          billsInDateRange(from, to),
          loadCategoryRows(),
        ]);
        if (alive) setData({ bills, roots: buildCategoryTree(rows) });
      } catch {
        if (alive) setData({ bills: [], roots: [] });
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode, month, year]);

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
      if (b.kind === "expense") expense[m] += b.amount_cents / 100;
      else income[m] += b.amount_cents / 100;
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

  const dailyStats = useMemo(() => {
    if (mode !== "monthly") return null;
    const values = [...seriesByDay.values()];
    if (values.length === 0) return null;
    const total = values.reduce((s, v) => s + v, 0);
    return {
      max: Math.max(...values),
      min: Math.min(...values),
      avg: Math.round(total / values.length),
    };
  }, [seriesByDay, mode]);

  const yearlyStats = useMemo(() => {
    if (mode !== "yearly") return null;
    const total = monthlyTrend[dailyKind === "expense" ? "expense" : "income"].reduce(
      (s, v) => s + Math.round(v * 100),
      0,
    );
    const nonZero = monthlyTrend[dailyKind === "expense" ? "expense" : "income"].filter(
      (v) => v > 0,
    );
    if (nonZero.length === 0) return null;
    return {
      max: Math.round(Math.max(...nonZero) * 100),
      min: Math.round(Math.min(...nonZero) * 100),
      avg: Math.round(total / 12),
    };
  }, [monthlyTrend, mode, dailyKind]);

  const ink3 = cssColor("--color-ink-3");
  const lineColor = cssColor("--color-line");
  const axisCommon = {
    axisLine: { lineStyle: { color: lineColor } },
    axisLabel: { color: ink3, fontSize: 10 },
    splitLine: { lineStyle: { color: lineColor } },
  };

  const dailyOption = useMemo<echarts.EChartsOption>(() => {
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
        valueFormatter: (v) => `¥${v}`,
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
  }, [month, seriesByDay, dailyKind, axisCommon]);

  const trendOption = useMemo<echarts.EChartsOption>(() => {
    const monthLabels = Array.from({ length: 12 }, (_, i) => `${i + 1}`);
    return {
      grid: { left: 44, right: 8, top: 24, bottom: 24 },
      xAxis: { type: "category", data: monthLabels, ...axisCommon },
      yAxis: { type: "value", ...axisCommon },
      tooltip: { trigger: "axis", valueFormatter: (v) => `¥${v}` },
      legend: {
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: ink3, fontSize: 10 },
        data: [t("stats.expense"), t("stats.income")],
      },
      series: [
        {
          name: t("stats.expense"),
          type: "line",
          smooth: true,
          data: monthlyTrend.expense,
          symbol: "circle",
          symbolSize: 5,
          lineStyle: { width: 2, color: cssColor("--color-expense") },
          itemStyle: { color: cssColor("--color-expense") },
        },
        {
          name: t("stats.income"),
          type: "line",
          smooth: true,
          data: monthlyTrend.income,
          symbol: "circle",
          symbolSize: 5,
          lineStyle: { width: 2, color: cssColor("--color-income") },
          itemStyle: { color: cssColor("--color-income") },
        },
      ],
    };
  }, [monthlyTrend, axisCommon, ink3, t]);

  const totalKindCents = shares.reduce((s, x) => s + x.cents, 0);
  const catName = (c: Category) => (c.name_key ? t(c.name_key) : c.name);
  const drillNode = drillPath[drillPath.length - 1] ?? null;
  const centerLabel = drillNode
    ? catName(drillNode)
    : shareKind === "expense"
      ? t("stats.totalExpense")
      : t("stats.totalIncome");
  const donutOption = useMemo<echarts.EChartsOption>(() => {
    const top = showAll ? shares : shares.slice(0, 5);
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
          data: top.map((s, i) => ({
            name: catName(s.cat),
            value: s.cents / 100,
            catId: s.cat.id,
            itemStyle: { color: DONUT_PALETTE[i % DONUT_PALETTE.length] },
          })),
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
  }, [shares, showAll, totalKindCents, locale, centerLabel, t]);

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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
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

        {/* 收支汇总横幅 */}
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

        {/* 每日收支 / 月趋势 */}
        <section className="mt-3 rounded-2xl bg-card p-3">
          <div className="flex items-center justify-between">
            <CardTitle
              text={mode === "monthly" ? t("stats.dailyFlow") : t("stats.monthlyTrend")}
            />
            {mode === "monthly" && (
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
            )}
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
                    <div
                      key={s.cat.id}
                      className="flex items-center rounded-lg py-1 active:bg-chip"
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
                    </div>
                  ))}
                  {shares.length > 5 && (
                    <button
                      type="button"
                      className="pt-1 text-xs text-brand"
                      onClick={() => setShowAll((v) => !v)}
                    >
                      {showAll ? "﹀" : "›"} {t("stats.viewAll")}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
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
