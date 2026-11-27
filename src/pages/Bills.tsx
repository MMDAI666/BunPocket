import { useEffect, useMemo, useRef, useState } from "react";
import { useAppBack } from "../hooks/useAppBack";
import { useAppNavigate } from "../hooks/useAppNavigate";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import {
  type BillRow,
  type Category,
  billsPage,
  dailyExpenseTotals,
  loadCategoryRows,
  searchBills,
} from "../db";
import {
  buildCategoryTree,
  findCategory,
  flattenCategoryTree,
} from "../lib/category";
import { formatMoneyCompact, monthDayLabel, weekdayShort } from "../lib/format";
import { errorMessage, logEvent } from "../lib/logger";
import { cn } from "../lib/cn";
import { IconBadge } from "../components/ui/IconBadge";
import { ErrorState } from "../components/ui/ErrorState";
import { PageHeader } from "../components/ui/PageHeader";
import { BrandMark } from "../components/BrandMark";
import { toast } from "../components/ui/Toast";
import { useLocale } from "../hooks/useLocale";

const PAGE_SIZE = 50;

export function Bills() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const navigate = useAppNavigate();
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
          : await billsPage(PAGE_SIZE, 0);
        if (!alive || queryId !== queryIdRef.current) return;
        setBills(rows);
        setHasMore(rows.length === PAGE_SIZE);
      } catch (error) {
        if (alive && queryId === queryIdRef.current) {
          setFailed(true);
          void logEvent("error", "bills.load.failed", {
            keyword: kw,
            message: errorMessage(error),
          });
        }
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
        : await billsPage(PAGE_SIZE, offset);
      if (queryId !== queryIdRef.current) return; // 查询已换代，丢弃旧分页
      setBills((prev) => [...(prev ?? []), ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (error) {
      void logEvent("error", "bills.loadMore.failed", {
        keyword: keyword.trim(),
        offset,
        message: errorMessage(error),
      });
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
      <PageHeader title={t("bills.title")} onBack={goBack} />

      <div className="px-3 pb-2 pt-1">
        <div className="flex items-center gap-2 rounded-[10px] border border-line bg-card px-3 py-2 transition-colors focus-within:border-brand">
          <Search size={16} strokeWidth={1.9} className="shrink-0 text-ink-3" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t("bills.searchPlaceholder")}
            aria-label={t("bills.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          {keyword !== "" && (
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-chip"
              onClick={() => setKeyword("")}
              aria-label={t("common.close")}
            >
              <X size={14} strokeWidth={1.9} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {failed && <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />}
        {!failed && bills === null && (
          <div className="paper py-12 text-center text-[13px] text-ink-3">…</div>
        )}
        {!failed && bills !== null && groups.length === 0 && (
          <div className="paper flex flex-col items-center gap-2 px-6 py-10 text-center">
            <BrandMark className="h-9 w-9 text-ink-3" />
            <div className="text-[13px] text-ink-3">
              {keyword.trim() !== "" ? t("bills.empty") : t("common.empty")}
            </div>
          </div>
        )}
        {!failed && groups.length > 0 && (
          <div className="paper overflow-hidden">
            {groups.map((group, index) => (
              <section key={group.date}>
                <div
                  className={cn(
                    "flex items-center justify-between bg-chip/50 px-3 py-1.5",
                    index > 0 && "border-t border-line",
                  )}
                >
                  <div className="flex items-baseline gap-1.5">
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
                    const cat = findCategory(categories, bill.category_id);
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
                            {cat
                              ? cat.name_key
                                ? t(cat.name_key)
                                : cat.name
                              : "—"}
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
        {!failed && hasMore && (
          <button
            type="button"
            disabled={loadingMore}
            className="mt-3 w-full rounded-[10px] border border-line bg-card py-2.5 text-[12px] text-ink-2 transition-colors hover:bg-chip active:bg-chip disabled:opacity-50"
            onClick={() => void loadMore()}
          >
            {loadingMore ? "…" : t("common.loadMore")}
          </button>
        )}
      </div>
    </div>
  );
}
