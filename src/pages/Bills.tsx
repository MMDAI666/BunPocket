import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppBack } from "../hooks/useAppBack";
import { useTranslation } from "react-i18next";
import {
  type BillRow,
  type Category,
  billsInDateRange,
  loadCategoryRows,
  searchBills,
} from "../db";
import { buildCategoryTree, findCategory } from "../lib/category";
import { formatMoneyCompact, todayStr, weekdayShort } from "../lib/format";
import { IconBadge } from "../components/ui/IconBadge";
import { ErrorState } from "../components/ui/ErrorState";
import { useLocale } from "../hooks/useLocale";

export function Bills() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const goBack = useAppBack();
  const [keyword, setKeyword] = useState("");
  const [bills, setBills] = useState<BillRow[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await loadCategoryRows();
        if (alive) setCategories(buildCategoryTree(rows));
      } catch {
        /* 浏览器环境 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setFailed(false);
    debounceRef.current = setTimeout(async () => {
      const kw = keyword.trim();
      try {
        let rows: BillRow[];
        if (kw) {
          rows = await searchBills(kw);
        } else {
          // 近 2 年流水
          const now = new Date();
          const from = `${now.getFullYear() - 1}-01-01`;
          const to = todayStr();
          rows = await billsInDateRange(from, to);
        }
        if (alive) setBills(rows);
      } catch {
        if (alive) setFailed(true);
      }
    }, 300);
    return () => {
      alive = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [keyword, reloadKey]);

  const groups = useMemo(() => {
    const byDay = new Map<string, BillRow[]>();
    for (const bill of bills ?? []) {
      const list = byDay.get(bill.date) ?? [];
      list.push(bill);
      byDay.set(bill.date, list);
    }
    return [...byDay.entries()].map(([date, list]) => ({
      date,
      bills: list,
      expenseCents: list
        .filter((b) => b.kind === "expense")
        .reduce((s, b) => s + b.amount_cents, 0),
    }));
  }, [bills]);

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="flex items-center gap-2 px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2">
        <button
          type="button"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-ink active:bg-chip"
          onClick={goBack}
          aria-label={t("common.back")}
        >
          ‹
        </button>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t("bills.searchPlaceholder")}
          className="h-9 min-w-0 flex-1 rounded-full bg-chip px-4 text-sm text-ink outline-none placeholder:text-ink-3"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
        {failed && (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        )}
        {!failed && bills === null && (
          <div className="py-10 text-center text-sm text-ink-3">…</div>
        )}
        {!failed && bills !== null && groups.length === 0 && (
          <div className="py-10 text-center text-sm text-ink-3">
            {t("common.empty")}
          </div>
        )}
        {!failed &&
          groups.map((group) => (
          <div key={group.date} className="mt-2">
            <div className="flex justify-between px-1 py-1 text-xs text-ink-3">
              <span>
                {group.date} {weekdayShort(group.date, locale)}
              </span>
              <span>
                {t("home.dayExpense")}:{" "}
                {formatMoneyCompact(group.expenseCents, locale)}
              </span>
            </div>
            <div className="divide-y divide-gray-100 rounded-2xl bg-card dark:divide-white/5">
              {group.bills.map((bill) => {
                const cat = findCategory(categories, bill.category_id);
                return (
                  <button
                    key={bill.id}
                    type="button"
                    className="flex w-full items-center px-3 py-2.5 text-left active:bg-chip"
                    onClick={() => navigate(`/add?id=${bill.id}`)}
                  >
                    <IconBadge icon={cat?.icon} iconImage={cat?.icon_image} nameKey={cat?.name_key} iconType={cat?.icon_type} />
                    <div className="ml-3 min-w-0 flex-1">
                      <div className="truncate text-[15px] text-ink">
                        {cat
                          ? cat.name_key
                            ? t(cat.name_key)
                            : cat.name
                          : "—"}
                      </div>
                      {bill.note && (
                        <div className="truncate text-xs text-ink-3">{bill.note}</div>
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
      </div>
    </div>
  );
}
