import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { BillKind, BillRow, Category } from "../db";
import { billsInDateRange, loadCategoryRows } from "../db";
import {
  buildCategoryTree,
  categoryPath,
  collectCategoryIds,
  findCategory,
} from "../lib/category";
import { parseStatsQuery, periodRange, statsPeriodLabel } from "../lib/stats";
import {
  formatMoneyCompact,
  monthDayLabel,
  weekdayShort,
} from "../lib/format";
import { errorMessage, logEvent } from "../lib/logger";
import { cn } from "../lib/cn";
import { useAppBack } from "../hooks/useAppBack";
import { useAppNavigate } from "../hooks/useAppNavigate";
import { useLocale } from "../hooks/useLocale";
import { IconBadge } from "../components/ui/IconBadge";
import { ErrorState } from "../components/ui/ErrorState";
import { PageHeader } from "../components/ui/PageHeader";
import { Segmented } from "../components/ui/Segmented";

const PAGE_SIZE = 50;
type SortMode = "time" | "amount";

export function CategoryBills() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { id } = useParams();
  const [params, setSearchParams] = useSearchParams();
  const goBack = useAppBack("/stats");
  const navigate = useAppNavigate();

  const categoryId = Number(id) || null;
  const query = useMemo(() => parseStatsQuery(params), [params]);
  const kind: BillKind = params.get("kind") === "income" ? "income" : "expense";
  const exact = params.get("exact") === "1";
  const period = useMemo(
    () => periodRange(query.mode, query.year, query.month),
    [query.mode, query.year, query.month],
  );
  const periodLabel = statsPeriodLabel(query, locale);
  const kindLabel = t(kind === "expense" ? "stats.expense" : "stats.income");

  const [roots, setRoots] = useState<Category[] | null>(null);
  const [bills, setBills] = useState<BillRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [sort, setSort] = useState<SortMode>(
    params.get("sort") === "amount" ? "amount" : "time",
  );
  const [visible, setVisible] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setRoots(null);
    setBills(null);
    void Promise.all([
      loadCategoryRows(),
      billsInDateRange(period.from, period.to),
    ])
      .then(([rows, periodBills]) => {
        if (!alive) return;
        setRoots(buildCategoryTree(rows));
        setBills(periodBills);
      })
      .catch((error) => {
        if (alive) setFailed(true);
        void logEvent("error", "category.bills.load.failed", {
          category_id: categoryId,
          kind,
          from: period.from,
          to: period.to,
          message: errorMessage(error),
        });
      });
    return () => {
      alive = false;
    };
  }, [period.from, period.to, reloadKey]);

  const tree = roots ?? [];
  const node = useMemo(() => {
    if (!categoryId || tree.length === 0) return null;
    const cat = findCategory(tree, categoryId);
    return cat && cat.kind === kind ? cat : null;
  }, [tree, categoryId, kind]);

  const scopeIds = useMemo(() => {
    if (!node) return new Set<number>();
    return new Set(exact ? [node.id] : collectCategoryIds(node));
  }, [node, exact]);

  const filtered = useMemo(
    () =>
      (bills ?? []).filter(
        (bill) => bill.kind === kind && scopeIds.has(bill.category_id),
      ),
    [bills, kind, scopeIds],
  );

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sort === "amount") {
      list.sort(
        (a, b) =>
          b.amount_cents - a.amount_cents ||
          b.occurred_at_ms - a.occurred_at_ms ||
          b.id - a.id,
      );
    } else {
      list.sort(
        (a, b) => b.occurred_at_ms - a.occurred_at_ms || b.id - a.id,
      );
    }
    return list;
  }, [filtered, sort]);

  const visibleBills = useMemo(
    () => sorted.slice(0, visible),
    [sorted, visible],
  );

  const dayTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const bill of filtered) {
      map.set(bill.date, (map.get(bill.date) ?? 0) + bill.amount_cents);
    }
    return map;
  }, [filtered]);

  const groups = useMemo(() => {
    if (sort !== "time") return [];
    const map = new Map<string, BillRow[]>();
    for (const bill of visibleBills) {
      const list = map.get(bill.date) ?? [];
      list.push(bill);
      map.set(bill.date, list);
    }
    return [...map.entries()];
  }, [sort, visibleBills]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [
    categoryId,
    query.mode,
    query.year,
    query.month,
    kind,
    exact,
    sort,
  ]);

  /** 排序写进 URL：从编辑页返回时能恢复"按金额"，而不是重置为按时间 */
  const changeSort = (next: SortMode) => {
    setSort(next);
    const nextParams = new URLSearchParams(params);
    if (next === "amount") nextParams.set("sort", "amount");
    else nextParams.delete("sort");
    setSearchParams(nextParams, { replace: true });
  };

  const catName = (cat: Category) =>
    cat.name_key ? t(cat.name_key) : cat.name;
  const catOf = (bill: BillRow) =>
    findCategory(tree, bill.category_id) ?? null;

  const renderBill = (bill: BillRow) => {
    const cat = catOf(bill);
    return (
      <button
        key={bill.id}
        type="button"
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-chip/50 active:bg-chip"
        onClick={() => navigate(`/bill/${bill.id}`)}
      >
        {sort === "time" && (
          <span className="num w-8 shrink-0 text-[10px] text-ink-3">
            {bill.time}
          </span>
        )}
        <IconBadge
          icon={cat?.icon}
          iconImage={cat?.icon_image}
          nameKey={cat?.name_key}
          iconType={cat?.icon_type}
          size="sm"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] text-ink">
            {cat ? catName(cat) : "—"}
          </span>
          {(sort === "amount" || bill.note) && (
            <span className="block truncate text-[11px] text-ink-3">
              {sort === "amount"
                ? `${monthDayLabel(bill.date, locale)} ${bill.time}${
                    bill.note ? ` · ${bill.note}` : ""
                  }`
                : bill.note}
            </span>
          )}
        </span>
        <span
          className={cn(
            "num ml-1 shrink-0 text-[14px] font-medium",
            bill.kind === "expense" ? "text-expense" : "text-income",
          )}
        >
          {bill.kind === "expense" ? "-" : "+"}
          {formatMoneyCompact(bill.amount_cents, locale)}
        </span>
      </button>
    );
  };

  const path = useMemo(
    () => (node ? categoryPath(tree, node.id) : []),
    [tree, node],
  );
  const title = node
    ? `${catName(node)}${exact ? ` · ${t("stats.selfLevel")}` : ""}${
        bills !== null ? ` (${filtered.length})` : ""
      }`
    : t("stats.categories");
  const loading = !failed && (roots === null || bills === null);
  const notFound = !failed && !loading && !node;
  const empty = !failed && !loading && node && filtered.length === 0;

  return (
    <div className="flex h-full flex-col bg-page">
      <PageHeader title={title} onBack={goBack} />

      <div className="px-4 pb-2 pt-0.5 text-[11px] text-ink-3">
        {path.length > 1 && (
          <span className="block truncate">
            {path
              .slice(0, -1)
              .map((cat) => catName(cat))
              .join(" › ")}{" "}
            ·{" "}
          </span>
        )}
        {periodLabel} · {kindLabel}
      </div>

      <div className="px-3 pb-2">
        <Segmented<SortMode>
          options={[
            { value: "time", label: t("stats.sortTime") },
            { value: "amount", label: t("stats.sortAmount") },
          ]}
          value={sort}
          onChange={changeSort}
        />
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(2rem+env(safe-area-inset-bottom))]"
      >
        {failed ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        ) : loading ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">…</div>
        ) : notFound || empty ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">
            {t("common.empty")}
          </div>
        ) : sort === "time" ? (
          <div className="paper overflow-hidden">
            {groups.map(([date, list], index) => (
              <section key={date}>
                <div
                  className={cn(
                    "flex items-center justify-between bg-chip/50 px-3 py-1.5",
                    index > 0 && "border-t border-line",
                  )}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[12px] font-medium text-ink">
                      {monthDayLabel(date, locale)}
                    </span>
                    <span className="text-[10px] text-ink-3">
                      {weekdayShort(date, locale)}
                    </span>
                  </div>
                  <span className="num text-[11px] text-ink-3">
                    {t(kind === "expense" ? "stats.expense" : "stats.income")}{" "}
                    {formatMoneyCompact(dayTotals.get(date) ?? 0, locale)}
                  </span>
                </div>
                <div className="divide-y divide-line">
                  {list.map(renderBill)}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="paper divide-y divide-line overflow-hidden">
            {visibleBills.map(renderBill)}
          </div>
        )}

        {!failed && !loading && !notFound && !empty && visible < sorted.length && (
          <button
            type="button"
            className="mt-3 w-full rounded-[10px] border border-line bg-card py-2.5 text-[12px] text-ink-2 transition-colors hover:bg-chip active:bg-chip"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
          >
            {t("common.loadMore")}
          </button>
        )}
      </div>
    </div>
  );
}
