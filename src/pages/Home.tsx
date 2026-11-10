import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChartColumn, Search, Settings } from "lucide-react";
import {
  type BillRow,
  type Category,
  billsInDateRange,
  budgetCycle,
  dailyExpenseTotals,
  daysUntilCycleEnd,
  getBudgets,
  loadCategoryRows,
  recentBills,
} from "../db";
import { buildCategoryTree, findCategory } from "../lib/category";
import {
  type CategoryBudgetRow,
  budgetProgress,
  budgetedRowsByUsage,
  categoryBudgetRows,
  isOverBudget,
  leafmostBudgetRows,
} from "../lib/budget";
import {
  formatMoneyCompact,
  todayStr,
  weekdayShort,
} from "../lib/format";
import { getSetting } from "../settings";
import { cn } from "../lib/cn";
import { IconBadge } from "../components/ui/IconBadge";
import { ErrorState } from "../components/ui/ErrorState";
import { ProgressRing } from "../components/ui/ProgressRing";
import { useLocale } from "../hooks/useLocale";

interface DayGroup {
  date: string;
  bills: BillRow[];
  expenseCents: number;
}

interface HomeData {
  todayCents: number;
  monthCents: number;
  groups: DayGroup[];
  budgetTotal: number;
  budgetSpent: number;
  daysLeft: number;
  categories: Category[];
  /** 设置了分类预算的分类（按周期使用率取前 3），预算卡下方展示 */
  categoryBudgets: CategoryBudgetRow[];
}

async function loadHome(): Promise<HomeData> {
  const rows = await loadCategoryRows();
  const categories = buildCategoryTree(rows);
  const billingDay = Math.min(
    Math.max(Number((await getSetting("billing_day")) ?? "1") || 1, 1),
    28,
  );
  const cycle = budgetCycle(billingDay);

  // 页头"本月支出"按自然月统计（与统计页口径一致）；预算卡按结算周期。
  // 两个区间可能错位，一次性取并集后按各自区间分别累加。
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthFrom = `${year}-${pad(month)}-01`;
  const monthTo = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;
  const rangeFrom = cycle.from < monthFrom ? cycle.from : monthFrom;
  const rangeTo = cycle.to > monthTo ? cycle.to : monthTo;

  const [recent, rangeBills, budgets] = await Promise.all([
    recentBills(10),
    billsInDateRange(rangeFrom, rangeTo),
    getBudgets(),
  ]);

  const today = todayStr();
  let todayCents = 0;
  let monthCents = 0;
  let budgetSpent = 0;
  for (const bill of rangeBills) {
    if (bill.kind !== "expense") continue;
    if (bill.date === today) todayCents += bill.amount_cents;
    if (bill.date >= monthFrom && bill.date <= monthTo) {
      monthCents += bill.amount_cents;
    }
    if (
      bill.date >= cycle.from &&
      bill.date <= cycle.to &&
      !bill.exclude_budget
    ) {
      budgetSpent += bill.amount_cents;
    }
  }

  const byDay = new Map<string, BillRow[]>();
  for (const bill of recent) {
    const list = byDay.get(bill.date) ?? [];
    list.push(bill);
    byDay.set(bill.date, list);
  }
  // 日头合计走 SQL 聚合：recent 只有 10 条，直接求和会在当天账单多于 10 笔时少算
  const oldestDate = recent.reduce(
    (min, bill) => (bill.date < min ? bill.date : min),
    today,
  );
  const dayTotals = await dailyExpenseTotals(oldestDate, today);
  const dayTotalByDate = new Map(dayTotals.map((row) => [row.date, row.total]));
  const groups: DayGroup[] = [...byDay.entries()].map(([date, bills]) => ({
    date,
    bills,
    expenseCents:
      dayTotalByDate.get(date) ??
      bills
        .filter((b) => b.kind === "expense")
        .reduce((sum, b) => sum + b.amount_cents, 0),
  }));

  const cycleBills = rangeBills.filter(
    (bill) => bill.date >= cycle.from && bill.date <= cycle.to,
  );
  const expenseRoots = categories.filter((cat) => cat.kind === "expense");
  // Top3 只取"最具体"的预算节点：父子都设预算时不把同一笔支出展示两遍
  const categoryBudgets = budgetedRowsByUsage(
    leafmostBudgetRows(
      categoryBudgetRows(expenseRoots, budgets.byCategory, cycleBills),
    ),
    3,
  );

  return {
    todayCents,
    monthCents,
    groups,
    budgetTotal: budgets.total,
    budgetSpent,
    daysLeft: daysUntilCycleEnd(cycle),
    categories,
    categoryBudgets,
  };
}

const EMPTY: HomeData = {
  todayCents: 0,
  monthCents: 0,
  groups: [],
  budgetTotal: 0,
  budgetSpent: 0,
  daysLeft: 1,
  categories: [],
  categoryBudgets: [],
};

export function Home() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const [data, setData] = useState<HomeData>(EMPTY);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setLoading(true);
    loadHome()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        // 不要降级成"空数据"，否则用户会误以为账本丢了
        if (!alive) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const remaining = data.budgetTotal - data.budgetSpent;
  const progress =
    data.budgetTotal > 0 ? data.budgetSpent / data.budgetTotal : 0;
  const dailyAllowance =
    data.budgetTotal > 0 ? Math.max(remaining, 0) / data.daysLeft : 0;

  const nameOf = (bill: BillRow) => {
    const cat = findCategory(data.categories, bill.category_id);
    return cat
      ? cat.name_key
        ? t(cat.name_key)
        : cat.name
      : t("common.empty");
  };
  const iconOf = (bill: BillRow) =>
    findCategory(data.categories, bill.category_id) ?? undefined;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* 渐变头部（延伸到状态栏后方，内部含预算卡） */}
      <header className="bg-gradient-to-r from-brand-1 to-brand-2 px-4 pt-[env(safe-area-inset-top)] text-white">
        <div className="flex items-center gap-2 pt-3">
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-white/20"
            onClick={() => navigate("/settings")}
            aria-label={t("settings.title")}
          >
            <Settings size={20} />
          </button>
          <button
            type="button"
            className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/25 px-3 text-xs text-white/90"
            onClick={() => navigate("/bills")}
          >
            <Search size={14} />
            <span>{t("home.searchBills")}</span>
          </button>
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-white/20"
            onClick={() => navigate("/stats")}
            aria-label={t("nav.stats")}
          >
            <ChartColumn size={20} />
          </button>
        </div>
        <div className="mt-3 flex items-center">
          <div className="flex-1 text-center">
            <div className="text-xs text-white/80">{t("home.todayExpense")}(¥)</div>
            <div className="mt-1 text-2xl font-light">
              {loading || failed ? "—" : formatMoneyCompact(data.todayCents, locale)}
            </div>
          </div>
          <div className="h-10 w-px bg-white/30" />
          <div className="flex-1 text-center">
            <div className="text-xs text-white/80">{t("home.monthExpense")}(¥)</div>
            <div className="mt-1 text-2xl font-light">
              {loading || failed ? "—" : formatMoneyCompact(data.monthCents, locale)}
            </div>
          </div>
        </div>

        {/* 月预算卡（头部内，紧凑布局） */}
        <div className="mt-3 pb-3">
          <div
            className="rounded-2xl bg-card px-3 py-2.5"
            onClick={() => navigate("/budget")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) =>
              (e.key === "Enter" || e.key === " ") && navigate("/budget")
            }
          >
            {loading || failed ? (
              <div className="py-2 text-center text-sm text-ink-3">…</div>
            ) : data.budgetTotal <= 0 ? (
              <div className="py-2 text-center text-sm text-ink-3">
                {t("budget.none")} · {t("home.setBudget")} →
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <ProgressRing progress={progress} size={56} stroke={5} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs font-semibold text-ink">
                      {formatMoneyCompact(Math.max(remaining, 0), locale)}
                    </span>
                    <span className="text-[9px] text-ink-3">
                      {t("home.budgetRemaining")}
                    </span>
                  </div>
                </div>
                <div className="flex flex-1 items-center justify-around">
                  <div className="text-center">
                    <div className="text-[10px] text-ink-3">{t("home.budgetDaily")}</div>
                    <div className="text-sm font-semibold text-ink">
                      {formatMoneyCompact(Math.floor(dailyAllowance), locale)}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] text-ink-3">{t("home.budgetDaysLeft")}</div>
                    <div className="text-sm font-semibold text-ink">
                      {data.daysLeft}
                      {t("home.budgetDaysUnit")}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 内容区：最近记录（失败时保留页面外壳与导航入口） */}
      <div className="flex-1 overflow-y-auto px-3 pt-4 pb-28">
        {failed ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        ) : loading ? (
          <div className="rounded-2xl bg-card py-10 text-center text-sm text-ink-3">
            …
          </div>
        ) : (
          <>
          {data.categoryBudgets.length > 0 && (
            <button
              type="button"
              className="mb-2 w-full rounded-2xl bg-card p-3 text-left active:bg-chip"
              onClick={() => navigate("/budget")}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-ink">
                  {t("home.categoryBudget")}
                </h2>
                <span className="text-xs text-ink-3">
                  {t("home.viewAll")} ›
                </span>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {data.categoryBudgets.map((row) => (
                  <div key={row.cat.id}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-ink-2">
                        {row.cat.name_key ? t(row.cat.name_key) : row.cat.name}
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
            </button>
          )}
          <div className="flex items-center justify-between px-1 pb-1">
            <h2 className="text-sm font-bold text-ink">
              {t("home.recentBills")}
            </h2>
            <button
              type="button"
              className="text-sm text-ink-3"
              onClick={() => navigate("/bills")}
            >
              {t("home.viewAll")} ›
            </button>
          </div>
          {data.groups.length === 0 && (
            <div className="rounded-2xl bg-card py-10 text-center text-sm text-ink-3">
              {t("common.empty")}
            </div>
          )}
          {data.groups.map((group) => (
            <div key={group.date} className="mt-2">
              <div className="flex justify-between px-1 py-1 text-xs text-ink-3">
                <span>
                  {group.date} {weekdayShort(group.date, locale)}
                </span>
                <span>
                  {t("home.dayExpense")}: {formatMoneyCompact(group.expenseCents, locale)}
                </span>
              </div>
              <div className="divide-y divide-gray-100 rounded-2xl bg-card dark:divide-white/5">
                {group.bills.map((bill) => {
                  const cat = iconOf(bill);
                  return (
                    <button
                      key={bill.id}
                      type="button"
                      className="flex w-full items-center px-3 py-2.5 text-left active:bg-chip"
                      onClick={() => navigate(`/add?id=${bill.id}`)}
                    >
                      <IconBadge
                        icon={cat?.icon}
                        iconImage={cat?.icon_image}
                        nameKey={cat?.name_key}
                        iconType={cat?.icon_type}
                      />
                      <div className="ml-3 min-w-0 flex-1">
                        <div className="truncate text-[15px] text-ink">
                          {nameOf(bill)}
                        </div>
                        {bill.note && (
                          <div className="truncate text-xs text-ink-3">
                            {bill.note}
                          </div>
                        )}
                      </div>
                      <span
                        className={
                          bill.kind === "expense"
                            ? "ml-3 text-[15px] text-expense"
                            : "ml-3 text-[15px] text-income"
                        }
                      >
                        {bill.kind === "expense" ? "-" : "+"}
                        {formatMoneyCompact(bill.amount_cents, locale)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          </>
        )}
      </div>

      {/* FAB */}
      <button
        type="button"
        className="absolute bottom-6 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-gradient-to-r from-brand-1 to-brand-2 text-3xl font-light text-white shadow-lg shadow-brand-2/40 active:scale-95"
        onClick={() => navigate("/add")}
        aria-label={t("nav.add")}
      >
        ＋
      </button>
    </div>
  );
}
