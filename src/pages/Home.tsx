import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChartColumn, ChevronRight, Plus, Search } from "lucide-react";
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
  dateRangeDays,
  formatMoneyCompact,
  monthDayLabel,
  todayStr,
  weekdayShort,
} from "../lib/format";
import { getSetting } from "../settings";
import { cn } from "../lib/cn";
import { errorMessage, logEvent } from "../lib/logger";
import { BrandMark } from "../components/BrandMark";
import { IconBadge } from "../components/ui/IconBadge";
import { BudgetRuler } from "../components/ui/BudgetRuler";
import { ErrorState } from "../components/ui/ErrorState";
import { useLocale } from "../hooks/useLocale";
import { useAppNavigate } from "../hooks/useAppNavigate";

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
  /** 周期时间位置 0~1（含今天），用于节奏标尺 */
  dayProgress: number;
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
  const daysLeft = daysUntilCycleEnd(cycle);
  const cycleDays = dateRangeDays(cycle.from, cycle.to);
  const dayProgress = Math.min(
    Math.max((cycleDays - daysLeft + 1) / cycleDays, 0),
    1,
  );

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
    daysLeft,
    dayProgress,
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
  dayProgress: 1,
  categories: [],
  categoryBudgets: [],
};

export function Home() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const navigate = useAppNavigate();
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
      .catch((error) => {
        // 不要降级成"空数据"，否则用户会误以为账本丢了
        void logEvent("error", "home.load.failed", {
          message: errorMessage(error),
        });
        if (!alive) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const remaining = data.budgetTotal - data.budgetSpent;
  const dailyAllowance =
    data.budgetTotal > 0 ? Math.max(remaining, 0) / data.daysLeft : 0;
  const today = todayStr();

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
    <div className="relative flex h-full flex-col overflow-hidden bg-page">
      {/* 书封：品牌印章、今日/本月双数字、预算标尺 */}
      <header className="cover shrink-0 rounded-b-[24px] px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-4">
        <div className="relative flex items-center gap-2">
          <button
            type="button"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-book transition-[background-color,scale] duration-150 hover:bg-book-deep active:scale-[0.96]"
            onClick={() => navigate("/settings")}
            aria-label={t("nav.settings")}
            title={t("nav.settings")}
          >
            <BrandMark className="h-[18px] w-[18px] text-cream" />
          </button>
          <div className="ml-auto flex items-center gap-0.5">
            <CoverIconButton
              label={t("home.searchBills")}
              onClick={() => navigate("/bills")}
            >
              <Search size={18} strokeWidth={1.9} />
            </CoverIconButton>
            <CoverIconButton
              label={t("nav.stats")}
              onClick={() => navigate("/stats")}
            >
              <ChartColumn size={18} strokeWidth={1.9} />
            </CoverIconButton>
          </div>
        </div>

        <div className="relative mt-3.5 grid grid-cols-[1fr_1px_1fr] items-center gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-cover-muted">
              {t("home.todayExpense")}
            </div>
            <div className="num mt-1 truncate text-[34px] leading-none font-bold tracking-[-0.035em] text-cover-ink">
              {loading || failed
                ? "—"
                : `¥${formatMoneyCompact(data.todayCents, locale)}`}
            </div>
          </div>
          <div className="h-11 bg-cover-line" />
          <div className="min-w-0 text-right">
            <div className="text-[11px] text-cover-muted">
              {t("home.monthExpense")}
            </div>
            <div className="num mt-1 truncate text-[34px] leading-none font-bold tracking-[-0.035em] text-cover-ink">
              {loading || failed
                ? "—"
                : `¥${formatMoneyCompact(data.monthCents, locale)}`}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="relative mt-4 w-full text-left"
          onClick={() => navigate("/budget")}
          aria-label={t("budget.title")}
        >
          {loading || failed ? (
            <div className="h-10 rounded-[10px] bg-cover-deep" />
          ) : data.budgetTotal <= 0 ? (
            <div className="flex items-center justify-between rounded-[10px] border border-cover-line px-3 py-2.5 text-[12px] text-cover-muted">
              <span>
                {t("budget.none")} · {t("home.setBudget")}
              </span>
              <ChevronRight size={15} strokeWidth={1.8} className="opacity-70" />
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2 text-[11px] text-cover-muted">
                <span>
                  {t("home.budgetRemaining")}{" "}
                  <span
                    className={cn(
                      "num text-[12px] font-semibold",
                      remaining < 0 ? "text-expense" : "text-cover-ink",
                    )}
                  >
                    ¥{formatMoneyCompact(remaining, locale)}
                  </span>
                </span>
                <span className="num shrink-0 text-cover-muted">
                  {t("home.budgetDaily")} ¥
                  {formatMoneyCompact(Math.floor(dailyAllowance), locale)} ·{" "}
                  {data.daysLeft}
                  {t("home.budgetDaysUnit")}
                </span>
              </div>
              <BudgetRuler
                className="mt-2"
                spent={data.budgetSpent}
                total={data.budgetTotal}
                dayProgress={data.dayProgress}
                onBook
                label={t("home.budgetRemaining")}
              />
              {remaining < 0 && (
                <div className="mt-1 text-right text-[10px] text-expense">
                  {t("budget.overBudget")} ¥
                  {formatMoneyCompact(Math.abs(remaining), locale)}
                </div>
              )}
            </>
          )}
        </button>
      </header>

      {/* 账页：分类预算 + 最近记录 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
        {failed ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        ) : loading ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">…</div>
        ) : (
          <div className="rise">
            {data.categoryBudgets.length > 0 && (
              <button
                type="button"
                className="paper mb-3 w-full p-3 text-left transition-colors hover:bg-chip/40 active:bg-chip"
                onClick={() => navigate("/budget")}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-ink">
                    {t("home.categoryBudget")}
                  </span>
                  <span className="flex items-center gap-0.5 text-[11px] text-ink-3">
                    {t("home.viewAll")}
                    <ChevronRight size={13} strokeWidth={1.8} />
                  </span>
                </div>
                <div className="mt-2.5 flex flex-col gap-2.5">
                  {data.categoryBudgets.map((row) => (
                    <div key={row.cat.id}>
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="min-w-0 flex-1 truncate text-ink-2">
                          {row.cat.name_key ? t(row.cat.name_key) : row.cat.name}
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
                            "h-full rounded-full transition-[width] duration-500",
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

            <div className="flex items-center justify-between px-1 pb-2">
              <h2 className="text-[13px] font-semibold text-ink">
                {t("home.recentBills")}
              </h2>
              <button
                type="button"
                className="flex items-center gap-0.5 text-[11px] text-ink-3 transition-colors hover:text-ink-2"
                onClick={() => navigate("/bills")}
              >
                {t("home.viewAll")}
                <ChevronRight size={13} strokeWidth={1.8} />
              </button>
            </div>

            {data.groups.length === 0 ? (
              <div className="paper flex flex-col items-center gap-2 px-6 py-9 text-center">
                <BrandMark className="h-10 w-10 text-ink-3" />
                <div className="text-[14px] font-semibold text-ink">
                  {t("home.emptyTitle")}
                </div>
                <div className="max-w-52 text-[12px] leading-5 text-ink-3">
                  {t("home.emptyHint")}
                </div>
                <button
                  type="button"
                  className="mt-1 rounded-[10px] bg-book px-4 py-2 text-[13px] font-medium text-cream"
                  onClick={() => navigate("/add")}
                >
                  {t("nav.add")}
                </button>
              </div>
            ) : (
              <div className="paper overflow-hidden">
                {data.groups.map((group, index) => (
                  <section key={group.date}>
                    <div
                      className={cn(
                        "flex items-center justify-between bg-chip/50 px-3 py-1.5",
                        index > 0 && "border-t border-line",
                      )}
                    >
                      <div className="flex items-baseline gap-1.5">
                        {group.date === today && (
                          <span className="rounded-[4px] bg-brand-soft px-1 py-0.5 text-[9px] font-medium text-brand">
                            {t("add.dateToday")}
                          </span>
                        )}
                        <span className="text-[12px] font-medium text-ink">
                          {monthDayLabel(group.date, locale)}
                        </span>
                        <span className="text-[10px] text-ink-3">
                          {weekdayShort(group.date, locale)}
                        </span>
                      </div>
                      <span className="num text-[11px] text-ink-3">
                        {t("home.dayExpense")}{" "}
                        {formatMoneyCompact(group.expenseCents, locale)}
                      </span>
                    </div>
                    <div className="divide-y divide-line">
                      {group.bills.map((bill) => {
                        const cat = iconOf(bill);
                        return (
                          <button
                            key={bill.id}
                            type="button"
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-chip/50 active:bg-chip"
                            onClick={() => navigate(`/bill/${bill.id}`)}
                          >
                            <span className="num w-8 shrink-0 text-[10px] text-ink-3">
                              {bill.time}
                            </span>
                            <IconBadge
                              icon={cat?.icon}
                              iconImage={cat?.icon_image}
                              nameKey={cat?.name_key}
                              iconType={cat?.icon_type}
                              size="sm"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] text-ink">
                                {nameOf(bill)}
                              </span>
                              {bill.note && (
                                <span className="block truncate text-[11px] text-ink-3">
                                  {bill.note}
                                </span>
                              )}
                            </span>
                            <span
                              className={cn(
                                "num ml-1 shrink-0 text-[14px] font-medium",
                                bill.kind === "expense"
                                  ? "text-expense"
                                  : "text-income",
                              )}
                            >
                              {bill.kind === "expense" ? "-" : "+"}
                              {formatMoneyCompact(bill.amount_cents, locale)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 记一笔：书封外的圆钮，主次靠位置与尺寸 */}
      <button
        type="button"
        className="group absolute bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex h-[54px] w-[54px] -translate-x-1/2 items-center justify-center rounded-full bg-brand-soft shadow-[0_14px_26px_-16px_rgba(47,107,94,0.55)] transition-[background-color,scale] duration-150 hover:bg-cover-deep active:scale-[0.96]"
        onClick={() => navigate("/add")}
        aria-label={t("nav.add")}
        title={t("nav.add")}
      >
        <Plus
          size={22}
          strokeWidth={2.1}
          className="text-brand transition-colors group-hover:text-book-deep"
        />
      </button>
    </div>
  );
}

function CoverIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center rounded-full text-cover-muted transition-colors hover:bg-cover-deep active:bg-cover-line"
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
  );
}
