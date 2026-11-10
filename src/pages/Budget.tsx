import { useEffect, useState } from "react";
import { useAppBack } from "../hooks/useAppBack";
import { useTranslation } from "react-i18next";
import {
  type Category,
  type DateRange,
  billsInDateRange,
  budgetCycle,
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
import { formatMoney, formatMoneyCompact } from "../lib/format";
import { MAX_AMOUNT_CENTS } from "../lib/money";
import { cn } from "../lib/cn";
import { getSetting, setSetting } from "../settings";
import { Wheel } from "../components/ui/Wheel";
import { Sheet } from "../components/ui/Sheet";
import { IconBadge } from "../components/ui/IconBadge";
import { ErrorState } from "../components/ui/ErrorState";
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
  const [roots, setRoots] = useState<Category[]>([]);
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
        setRoots(expenseRoots);
        setBillingDay(billing);
        setCycle(cycleRange);
        setBudgetRows(
          annotateBudgetRows(
            categoryBudgetRows(expenseRoots, budgets.byCategory, bills),
          ),
        );
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
      setEditCatId(null);
      if (editCatId === 0) setTotal(cents > 0 ? cents : null);
      // 重新加载整页数据：树/预算/已用统一由 categoryBudgetRows 重算
      setReloadKey((k) => k + 1);
    } catch {
      toast.show(t("common.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  // 只设子分类预算时也要计入合计；父子都设时只算最上层，避免重复
  const categoryBudgetSum = topmostBudgetTotal(budgetRows);
  const categorySumExceedsTotal =
    total != null && categoryBudgetSum > total;

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="flex items-center px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-1">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-ink active:bg-chip"
          onClick={goBack}
          aria-label={t("common.back")}
        >
          ‹
        </button>
        <div className="flex-1 text-center text-base font-semibold text-ink">
          {t("budget.title")}
        </div>
        <div className="w-10" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
        {failed ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        ) : loading ? (
          <div className="py-10 text-center text-sm text-ink-3">…</div>
        ) : (
          <>
            <div className="rounded-2xl bg-card">
              <button
                type="button"
                className="flex w-full items-center px-4 py-4 active:bg-chip"
                onClick={() => openEdit(0, total)}
              >
                <span className="flex-1 text-[15px] text-ink">
                  {t("budget.total")}
                </span>
                <span
                  className={
                    total != null
                      ? "text-lg font-semibold text-brand"
                      : "text-sm text-ink-3"
                  }
                >
                  {total != null
                    ? `¥${formatMoney(total, locale)}`
                    : t("budget.none")}
                </span>
                <span className="ml-2 text-ink-3">›</span>
              </button>
              <div className="mx-4 border-t border-line" />
              <button
                type="button"
                className="flex w-full items-center px-4 py-4 active:bg-chip"
                onClick={() => {
                  setDayDraft(billingDay);
                  setDayOpen(true);
                }}
              >
                <span className="flex-1 text-[15px] text-ink">
                  {t("budget.billingDay")}
                </span>
                <span className="text-lg font-semibold text-ink">
                  {billingDay}
                </span>
                <span className="ml-2 text-ink-3">›</span>
              </button>
            </div>

            <div className="flex items-baseline justify-between px-1 pt-4 pb-2">
              <h2 className="text-sm font-bold text-ink">
                {t("budget.byCategory")}
              </h2>
              {cycle && (
                <span className="text-[10px] text-ink-3">
                  {t("budget.cycleRange", {
                    from: cycle.from,
                    to: cycle.to,
                  })}
                </span>
              )}
            </div>
            {categorySumExceedsTotal && (
              <div className="mb-2 rounded-xl bg-expense/10 px-3 py-2 text-xs text-expense">
                {t("budget.categorySumHint")}
              </div>
            )}
            <div className="rounded-2xl bg-card">
              {budgetRows.map((row) => {
                const { cat, depth, budget, spent } = row;
                const over = isOverBudget(row);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={cn(
                      "w-full py-3 pr-3 text-left active:bg-chip",
                      depth > 0 && "border-t border-line/60",
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
                      <span className="ml-2 min-w-0 flex-1 truncate text-[15px] text-ink">
                        {cat.name_key ? t(cat.name_key) : cat.name}
                        {row.hasBudgetedDescendant && (
                          <span className="ml-1 text-[10px] text-ink-3">
                            {t("budget.includesChildren")}
                          </span>
                        )}
                      </span>
                      {budget > 0 ? (
                        <span
                          className={cn(
                            "ml-2 shrink-0 text-sm",
                            over ? "font-medium text-expense" : "text-ink-2",
                          )}
                        >
                          {formatMoneyCompact(spent, locale)} / ¥
                          {formatMoneyCompact(budget, locale)}
                        </span>
                      ) : (
                        <span className="ml-2 shrink-0 text-xs text-ink-3">
                          {t("budget.used")}{" "}
                          {formatMoneyCompact(spent, locale)} ·{" "}
                          {t("budget.none")}
                        </span>
                      )}
                      <span className="ml-2 text-ink-3">›</span>
                    </div>
                    {budget > 0 && (
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-chip">
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
                    {budget > 0 && over && (
                      <div className="mt-1 text-[10px] text-expense">
                        {t("budget.overBudget")}
                      </div>
                    )}
                    {budget > 0 && row.childBudgetSum > budget && (
                      <div className="mt-1 text-[10px] text-expense">
                        {t("budget.childSumHint")}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {roots.length === 0 && (
              <div className="py-10 text-center text-sm text-ink-3">
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
          <div className="flex gap-3">
            <input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              inputMode="decimal"
              placeholder={t("budget.amountPlaceholder")}
              className="min-w-0 flex-1 rounded-full border border-line bg-card px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand"
            />
            <button
              type="button"
              disabled={saving}
              className="rounded-full bg-gradient-to-r from-brand-1 to-brand-2 px-5 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void saveEdit()}
            >
              {t("common.save")}
            </button>
          </div>
        }
      >
        <div className="py-2 text-center text-sm text-ink-3">
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
          className="mt-2 w-full rounded-full bg-gradient-to-r from-brand-1 to-brand-2 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => {
            if (saving) return;
            setSaving(true);
            void setSetting("billing_day", String(dayDraft))
              .then(() => {
                setBillingDay(dayDraft);
                setReloadKey((k) => k + 1);
                setDayOpen(false);
              })
              .catch(() => toast.show(t("common.saveFailed"), "error"))
              .finally(() => setSaving(false));
          }}
        >
          {t("common.ok")}
        </button>
      </Sheet>
    </div>
  );
}
