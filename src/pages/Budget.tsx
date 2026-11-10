import { useEffect, useState } from "react";
import { useAppBack } from "../hooks/useAppBack";
import { useTranslation } from "react-i18next";
import {
  type Category,
  getBudgets,
  loadCategoryRows,
  setBudget,
} from "../db";
import { buildCategoryTree } from "../lib/category";
import { formatMoney } from "../lib/format";
import { MAX_AMOUNT_CENTS } from "../lib/money";
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
  const [byCategory, setByCategory] = useState<Record<number, number>>({});
  const [roots, setRoots] = useState<Category[]>([]);
  const [billingDay, setBillingDay] = useState(1);

  const [editCatId, setEditCatId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dayOpen, setDayOpen] = useState(false);
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
        if (!alive) return;
        setTotal(budgets.total > 0 ? budgets.total : null);
        setByCategory(budgets.byCategory);
        setRoots(buildCategoryTree(rows).filter((c) => c.kind === "expense"));
        setBillingDay(Math.min(Math.max(Number(day) || 1, 1), 28));
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
      if (editCatId === 0) {
        setTotal(cents > 0 ? cents : null);
      } else if (cents > 0) {
        setByCategory((prev) => ({ ...prev, [editCatId]: cents }));
      } else {
        setByCategory((prev) => {
          const next = { ...prev };
          delete next[editCatId];
          return next;
        });
      }
    } catch {
      toast.show(t("common.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const expenseRoots = roots;

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
            <span className="flex-1 text-[15px] text-ink">{t("budget.total")}</span>
            <span className={total != null ? "text-lg font-semibold text-brand" : "text-sm text-ink-3"}>
              {total != null ? `¥${formatMoney(total, locale)}` : t("budget.none")}
            </span>
            <span className="ml-2 text-ink-3">›</span>
          </button>
          <div className="mx-4 border-t border-line" />
          <button
            type="button"
            className="flex w-full items-center px-4 py-4 active:bg-chip"
            onClick={() => setDayOpen(true)}
          >
            <span className="flex-1 text-[15px] text-ink">{t("budget.billingDay")}</span>
            <span className="text-lg font-semibold text-ink">{billingDay}</span>
            <span className="ml-2 text-ink-3">›</span>
          </button>
        </div>

        <h2 className="px-1 pt-4 pb-2 text-sm font-bold text-ink">
          {t("budget.byCategory")}
        </h2>
        <div className="divide-y divide-gray-100 rounded-2xl bg-card dark:divide-white/5">
          {expenseRoots.map((cat) => {
            const value = byCategory[cat.id];
            return (
              <button
                key={cat.id}
                type="button"
                className="flex w-full items-center px-4 py-3 active:bg-chip"
                onClick={() => openEdit(cat.id, value ?? null)}
              >
                <IconBadge icon={cat.icon} iconImage={cat.icon_image} nameKey={cat.name_key} iconType={cat.icon_type} size="sm" />
                <span className="ml-2 flex-1 text-left text-[15px] text-ink">
                  {cat.name_key ? t(cat.name_key) : cat.name}
                </span>
                <span
                  className={
                    value != null
                      ? "text-[15px] font-medium text-ink"
                      : "text-sm text-ink-3"
                  }
                >
                  {value != null ? `¥${formatMoney(value, locale)}` : t("budget.none")}
                </span>
                <span className="ml-2 text-ink-3">›</span>
              </button>
            );
          })}
        </div>
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

      {/* 结算日滚轮 */}
      <Sheet open={dayOpen} onOpenChange={setDayOpen} title={t("budget.billingDay")}>
        <Wheel
          items={BILLING_DAYS}
          value={billingDay}
          onChange={(v) => setBillingDay(v)}
        />
        <button
          type="button"
          disabled={saving}
          className="mt-2 w-full rounded-full bg-gradient-to-r from-brand-1 to-brand-2 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => {
            if (saving) return;
            setSaving(true);
            void setSetting("billing_day", String(billingDay))
              .then(() => setDayOpen(false))
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
