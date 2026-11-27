import { useEffect, useState } from "react";
import { useAppBack } from "../hooks/useAppBack";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import {
  type DateRange,
  billsInDateRange,
  budgetCycle,
  daysUntilCycleEnd,
  getBudgets,
  loadCategoryRows,
  setBudget,
} from "../db";
import { buildCategoryTree } from "../lib/category";
import {
  type BudgetRowMeta,
  annotateBudgetRows,
  budgetProgress,
  categoryBudgetRows,
  isOverBudget,
  topmostBudgetTotal,
} from "../lib/budget";
import { dateRangeDays, formatMoney, formatMoneyCompact } from "../lib/format";
import { errorMessage, logEvent } from "../lib/logger";
import { MAX_AMOUNT_CENTS } from "../lib/money";
import { cn } from "../lib/cn";
import { getSetting, setSetting } from "../settings";
import { Wheel } from "../components/ui/Wheel";
import { Sheet } from "../components/ui/Sheet";
import { IconBadge } from "../components/ui/IconBadge";
import { ErrorState } from "../components/ui/ErrorState";
import { BudgetRuler } from "../components/ui/BudgetRuler";
import { PageHeader } from "../components/ui/PageHeader";
import { toast } from "../components/ui/Toast";
import { useLocale } from "../hooks/useLocale";

const BILLING_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** 元的字符串 → 分（无效/超上限返回 null） */
function yuanToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d*\.?\d{0,2}$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    return null;
  }
  const cents = Math.round(Number(trimmed) * 100);
  return Number.isFinite(cents) && cents >= 0 && cents <= MAX_AMOUNT_CENTS
    ? cents
    : null;
}

export function Budget() {
  const { t } = useTranslation();
  const goBack = useAppBack();
  const { locale } = useLocale();
  const [total, setTotal] = useState<number | null>(null);
  const [spentTotal, setSpentTotal] = useState(0);
  const [billingDay, setBillingDay] = useState(1);
  const [cycle, setCycle] = useState<DateRange | null>(null);
  const [budgetRows, setBudgetRows] = useState<BudgetRowMeta[]>([]);

  const [editCatId, setEditCatId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dayOpen, setDayOpen] = useState(false);
  const [dayDraft, setDayDraft] = useState(1);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setLoading(true);
    (async () => {
      try {
        const [budgets, rows, day] = await Promise.all([
          getBudgets(),
          loadCategoryRows(),
          getSetting("billing_day"),
        ]);
        const billing = Math.min(Math.max(Number(day) || 1, 1), 28);
        const cycleRange = budgetCycle(billing);
        const bills = await billsInDateRange(cycleRange.from, cycleRange.to);
        if (!alive) return;
        const expenseRoots = buildCategoryTree(rows).filter(
          (c) => c.kind === "expense",
        );
        setTotal(budgets.total > 0 ? budgets.total : null);
        setBillingDay(billing);
        setCycle(cycleRange);
        setSpentTotal(
          bills
            .filter((bill) => bill.kind === "expense" && !bill.exclude_budget)
            .reduce((sum, bill) => sum + bill.amount_cents, 0),
        );
        setBudgetRows(
          annotateBudgetRows(
            categoryBudgetRows(expenseRoots, budgets.byCategory, bills),
          ),
        );
        setLoading(false);
      } catch (error) {
        if (!alive) return;
        void logEvent("error", "budget.load.failed", {
          message: errorMessage(error),
        });
        setFailed(true);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const openEdit = (catId: number, current: number | null) => {
    setEditCatId(catId);
    setEditValue(current != null ? String(current / 100) : "");
  };

  const saveEdit = async () => {
    if (editCatId == null || saving) return;
    const trimmed = editValue.trim();
    const cents = trimmed === "" ? 0 : yuanToCents(editValue);
    if (cents == null) {
      toast.show(t("common.invalidAmount"), "error");
      return;
    }
    setSaving(true);
    try {
      await setBudget(editCatId, cents);
      await logEvent("info", "budget.set", {
        category_id: editCatId,
        amount_cents: cents,
      });
      setEditCatId(null);
      if (editCatId === 0) setTotal(cents > 0 ? cents : null);
      // 重新加载整页数据：树/预算/已用统一由 categoryBudgetRows 重算
      setReloadKey((k) => k + 1);
    } catch (error) {
      void logEvent("error", "budget.set.failed", {
        category_id: editCatId,
        amount_cents: cents,
        message: errorMessage(error),
      });
      toast.show(t("common.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  // 只设子分类预算时也要计入合计；父子都设时只算最上层，避免重复
  const categoryBudgetSum = topmostBudgetTotal(budgetRows);
  const categorySumExceedsTotal =
    total != null && categoryBudgetSum > total;
  const cycleDays = cycle ? dateRangeDays(cycle.from, cycle.to) : 1;
  const daysLeft = cycle ? daysUntilCycleEnd(cycle) : 1;
  const dayProgress = Math.min(
    Math.max((cycleDays - daysLeft + 1) / cycleDays, 0),
    1,
  );

  return (
    <div className="flex h-full flex-col bg-page">
      <PageHeader title={t("budget.title")} onBack={goBack} />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {failed ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        ) : loading ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">…</div>
        ) : (
          <>
            <div className="paper p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] text-ink-3">{t("budget.total")}</div>
                  <button
                    type="button"
                    className={cn(
                      "mt-1 block truncate text-left transition-colors",
                      total != null ? "text-ink" : "text-ink-3",
                    )}
                    onClick={() => openEdit(0, total)}
                  >
                    {total != null ? (
                      <span className="num text-[27px] leading-none font-semibold tracking-[-0.03em]">
                        <span className="mr-1 align-top text-[14px] font-medium text-ink-3">
                          ¥
                        </span>
                        {formatMoney(total, locale)}
                      </span>
                    ) : (
                      <span className="text-[14px]">{t("budget.none")}</span>
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-[9px] border border-line px-2.5 py-1.5 text-[11px] text-ink-3 transition-colors hover:bg-chip"
                  onClick={() => {
                    setDayDraft(billingDay);
                    setDayOpen(true);
                  }}
                >
                  {t("budget.billingDay")}{" "}
                  <span className="num font-medium text-ink">{billingDay}</span>
                </button>
              </div>

              {total != null && (
                <div className="mt-3.5">
                  <div className="flex items-baseline justify-between gap-2 text-[10px] text-ink-3">
                    <span>
                      {t("budget.used")}{" "}
                      <span className="num text-[12px] font-semibold text-ink">
                        ¥{formatMoneyCompact(spentTotal, locale)}
                      </span>
                    </span>
                    <span className="num">
                      {t("home.budgetDaysLeft")} {daysLeft}
                      {t("home.budgetDaysUnit")}
                    </span>
                  </div>
                  <BudgetRuler
                    className="mt-2"
                    spent={spentTotal}
                    total={total}
                    dayProgress={dayProgress}
                    label={t("budget.total")}
                  />
                  {spentTotal > total && (
                    <div className="mt-1.5 flex justify-end">
                      <span className="stamp stamp-in text-expense">
                        {t("budget.overBudget")}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-baseline justify-between px-1 pt-4 pb-2">
              <h2 className="text-[13px] font-semibold text-ink">
                {t("budget.byCategory")}
              </h2>
              {cycle && (
                <span className="num text-[9px] text-ink-3">
                  {t("budget.cycleRange", {
                    from: cycle.from,
                    to: cycle.to,
                  })}
                </span>
              )}
            </div>
            {categorySumExceedsTotal && (
              <div className="mb-2 rounded-[9px] bg-peach-soft px-3 py-2 text-[11px] text-expense">
                {t("budget.categorySumHint")}
              </div>
            )}
            <div className="paper overflow-hidden">
              {budgetRows.map((row, index) => {
                const { cat, depth, budget, spent } = row;
                const over = isOverBudget(row);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={cn(
                      "w-full py-3 pr-3 text-left transition-colors hover:bg-chip/40 active:bg-chip",
                      index > 0 && "border-t border-line",
                    )}
                    style={{ paddingLeft: 16 + depth * 18 }}
                    onClick={() => openEdit(cat.id, budget > 0 ? budget : null)}
                  >
                    <div className="flex items-center">
                      <IconBadge
                        icon={cat.icon}
                        iconImage={cat.icon_image}
                        nameKey={cat.name_key}
                        iconType={cat.icon_type}
                        size="sm"
                      />
                      <span className="ml-2 min-w-0 flex-1 truncate text-[13px] text-ink">
                        {cat.name_key ? t(cat.name_key) : cat.name}
                        {row.hasBudgetedDescendant && (
                          <span className="ml-1 text-[9px] text-ink-3">
                            {t("budget.includesChildren")}
                          </span>
                        )}
                      </span>
                      {budget > 0 ? (
                        <span
                          className={cn(
                            "num ml-2 shrink-0 text-[12px]",
                            over ? "font-medium text-expense" : "text-ink-2",
                          )}
                        >
                          {formatMoneyCompact(spent, locale)}
                          <span className="text-ink-3"> / </span>
                          {formatMoneyCompact(budget, locale)}
                        </span>
                      ) : (
                        <span className="ml-2 shrink-0 text-[10px] text-ink-3">
                          {t("budget.used")}{" "}
                          {formatMoneyCompact(spent, locale)} · {t("budget.none")}
                        </span>
                      )}
                      <ChevronRight
                        size={14}
                        strokeWidth={1.8}
                        className="ml-1 shrink-0 text-ink-3"
                      />
                    </div>
                    {budget > 0 && (
                      <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-chip">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            over ? "bg-expense" : "bg-brand",
                          )}
                          style={{
                            width: `${Math.round(budgetProgress(row) * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                    {(over || (budget > 0 && row.childBudgetSum > budget)) && (
                      <div className="mt-1.5 flex items-center justify-end gap-2">
                        {row.childBudgetSum > budget && (
                          <span className="text-[9px] text-ink-3">
                            {t("budget.childSumHint")}
                          </span>
                        )}
                        {over && (
                          <span className="stamp stamp-in text-expense">
                            {t("budget.overBudget")}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {budgetRows.length === 0 && (
              <div className="paper py-12 text-center text-[13px] text-ink-3">
                {t("common.empty")}
              </div>
            )}
          </>
        )}
      </div>

      {/* 金额编辑 */}
      <Sheet
        open={editCatId != null}
        onOpenChange={(v) => !v && setEditCatId(null)}
        title={editCatId === 0 ? t("budget.total") : t("budget.categoryAmount")}
        footer={
          <div className="flex gap-2.5">
            <input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              inputMode="decimal"
              placeholder={t("budget.amountPlaceholder")}
              className="min-w-0 flex-1 rounded-[9px] border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-brand"
            />
            <button
              type="button"
              disabled={saving}
              className="rounded-[9px] bg-book px-5 py-2 text-[13px] font-medium text-cream disabled:opacity-50"
              onClick={() => void saveEdit()}
            >
              {t("common.save")}
            </button>
          </div>
        }
      >
        <div className="py-2 text-center text-[12px] text-ink-3">
          {t("budget.amountPlaceholder")}
        </div>
      </Sheet>

      {/* 结算日滚轮（draft：点确定才落库，关掉弹层不会误显示未保存值） */}
      <Sheet open={dayOpen} onOpenChange={setDayOpen} title={t("budget.billingDay")}>
        <Wheel
          items={BILLING_DAYS}
          value={dayDraft}
          onChange={setDayDraft}
          ariaLabel={t("budget.billingDay")}
        />
        <button
          type="button"
          disabled={saving}
          className="mt-2 w-full rounded-[10px] bg-book py-2.5 text-[13px] font-medium text-cream disabled:opacity-50"
          onClick={() => {
            if (saving) return;
            setSaving(true);
            void setSetting("billing_day", String(dayDraft))
              .then(async () => {
                await logEvent("info", "budget.billingDay", {
                  day: dayDraft,
                });
                setBillingDay(dayDraft);
                setReloadKey((k) => k + 1);
                setDayOpen(false);
              })
              .catch((error) => {
                void logEvent("error", "budget.billingDay.failed", {
                  day: dayDraft,
                  message: errorMessage(error),
                });
                toast.show(t("common.saveFailed"), "error");
              })
              .finally(() => setSaving(false));
          }}
        >
          {t("common.ok")}
        </button>
      </Sheet>
    </div>
  );
}
