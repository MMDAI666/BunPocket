import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppBack } from "../hooks/useAppBack";
import { useTranslation } from "react-i18next";
import {
  type BillRow,
  type Category,
  billsInDateRangePaged,
  dailyExpenseTotals,
  loadCategoryRows,
  searchBills,
} from "../db";
import {
  buildCategoryTree,
  findCategory,
  flattenCategoryTree,
} from "../lib/category";
import { formatMoneyCompact, todayStr, weekdayShort } from "../lib/format";
import { IconBadge } from "../components/ui/IconBadge";
import { ErrorState } from "../components/ui/ErrorState";
import { toast } from "../components/ui/Toast";
import { useLocale } from "../hooks/useLocale";

const PAGE_SIZE = 50;

/** 列表模式的时间窗：去年 1 月 1 日至今（分页加载） */
function defaultFrom(): string {
  return `${new Date().getFullYear() - 1}-01-01`;
}

export function Bills() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const goBack = useAppBack();
  const [keyword, setKeyword] = useState("");
  const [bills, setBills] = useState<BillRow[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [dayTotals, setDayTotals] = useState<Map<string, number>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** 查询代际：关键词变化后丢弃旧的 loadMore 结果，避免串页 */
  const queryIdRef = useRef(0);

  const flatCategories = useMemo(
    () => flattenCategoryTree(categories),
    [categories],
  );

  /**
   * 当前语言下的分类显示名命中 keyword 的分类 id（数据库只存中文名，需要前端补本地化匹配）。
   * 命中父分类时展开其全部后代，符合"搜餐饮应包含零食/外卖账单"的直觉。
   */
  const matchCategoryIds = (kw: string): number[] => {
    const lower = kw.toLowerCase();
    const matched = new Set<number>();
    const childrenOf = new Map<number, number[]>();
    for (const { cat } of flatCategories) {
      if (cat.parent_id != null) {
        const list = childrenOf.get(cat.parent_id) ?? [];
        list.push(cat.id);
        childrenOf.set(cat.parent_id, list);
      }
      const localized = cat.name_key ? t(cat.name_key) : cat.name;
      if (
        localized.toLowerCase().includes(lower) ||
        cat.name.toLowerCase().includes(lower)
      ) {
        matched.add(cat.id);
      }
    }
    const stack = [...matched];
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const childId of childrenOf.get(id) ?? []) {
        if (!matched.has(childId)) {
          matched.add(childId);
          stack.push(childId);
        }
      }
    }
    return [...matched];
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await loadCategoryRows();
        if (alive) setCategories(buildCategoryTree(rows));
      } catch {
        /* 分类加载失败时列表仍可按备注/存储名搜索 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const queryId = ++queryIdRef.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setFailed(false);
    // 新查询未返回前禁用"加载更多"，避免用旧 offset 拼到新结果上
    setHasMore(false);
    debounceRef.current = setTimeout(async () => {
      const kw = keyword.trim();
      try {
        const rows = kw
          ? await searchBills(kw, matchCategoryIds(kw), PAGE_SIZE, 0)
          : await billsInDateRangePaged(defaultFrom(), todayStr(), PAGE_SIZE, 0);
        if (!alive || queryId !== queryIdRef.current) return;
        setBills(rows);
        setHasMore(rows.length === PAGE_SIZE);
      } catch {
        if (alive && queryId === queryIdRef.current) setFailed(true);
      }
    }, 300);
    return () => {
      alive = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // matchCategoryIds 依赖 flatCategories / t，这里用显式依赖表达
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, reloadKey, flatCategories, t]);

  // 列表模式下日头合计同样走 SQL 聚合（分页边界日不会被截断）；搜索结果按已加载行合计
  useEffect(() => {
    if (keyword.trim() !== "" || !bills || bills.length === 0) {
      setDayTotals(new Map());
      return;
    }
    let alive = true;
    const dates = bills.map((bill) => bill.date);
    const from = dates.reduce((a, b) => (a < b ? a : b));
    const to = dates.reduce((a, b) => (a > b ? a : b));
    void dailyExpenseTotals(from, to)
      .then((rows) => {
        if (!alive) return;
        setDayTotals(new Map(rows.map((row) => [row.date, row.total])));
      })
      .catch(() => {
        /* 聚合失败时回退到已加载行合计 */
      });
    return () => {
      alive = false;
    };
  }, [bills, keyword]);

  const loadMore = async () => {
    if (!hasMore || loadingMore || failed) return;
    const queryId = queryIdRef.current;
    const offset = bills?.length ?? 0;
    setLoadingMore(true);
    try {
      const kw = keyword.trim();
      const rows = kw
        ? await searchBills(kw, matchCategoryIds(kw), PAGE_SIZE, offset)
        : await billsInDateRangePaged(
            defaultFrom(),
            todayStr(),
            PAGE_SIZE,
            offset,
          );
      if (queryId !== queryIdRef.current) return; // 查询已换代，丢弃旧分页
      setBills((prev) => [...(prev ?? []), ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      toast.show(t("common.loadFailed"), "error");
    } finally {
      setLoadingMore(false);
    }
  };

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
      expenseCents:
        dayTotals.get(date) ??
        list
          .filter((b) => b.kind === "expense")
          .reduce((s, b) => s + b.amount_cents, 0),
    }));
  }, [bills, dayTotals]);

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
          aria-label={t("bills.searchPlaceholder")}
          className="h-9 min-w-0 flex-1 rounded-full bg-chip px-4 text-sm text-ink outline-none placeholder:text-ink-3"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
        {failed && <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />}
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
                      <IconBadge
                        icon={cat?.icon}
                        iconImage={cat?.icon_image}
                        nameKey={cat?.name_key}
                        iconType={cat?.icon_type}
                      />
                      <div className="ml-3 min-w-0 flex-1">
                        <div className="truncate text-[15px] text-ink">
                          {cat
                            ? cat.name_key
                              ? t(cat.name_key)
                              : cat.name
                            : "—"}
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
        {!failed && hasMore && (
          <button
            type="button"
            disabled={loadingMore}
            className="mt-3 w-full rounded-2xl border border-dashed border-line py-2.5 text-sm text-ink-2 active:bg-chip disabled:opacity-50"
            onClick={() => void loadMore()}
          >
            {loadingMore ? "…" : t("common.loadMore")}
          </button>
        )}
      </div>
    </div>
  );
}
