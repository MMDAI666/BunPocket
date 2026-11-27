import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type { BillKind, BillRow, Category } from "../db";
import { billsInDateRange, loadCategoryRows } from "../db";
import {
  buildCategoryTree,
  categoryPath,
  findCategory,
  rollupByNodeWithCounts,
  rollupByTopLevelWithCounts,
} from "../lib/category";
import { parseStatsQuery, periodRange, statsPeriodLabel } from "../lib/stats";
import { formatMoneyCompact } from "../lib/format";
import { errorMessage, logEvent } from "../lib/logger";
import { cn } from "../lib/cn";
import { useAppBack } from "../hooks/useAppBack";
import { useAppNavigate } from "../hooks/useAppNavigate";
import { useLocale } from "../hooks/useLocale";
import { IconBadge } from "../components/ui/IconBadge";
import { ErrorState } from "../components/ui/ErrorState";
import { PageHeader } from "../components/ui/PageHeader";

export function StatsCategories() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [params] = useSearchParams();
  const goBack = useAppBack("/stats");
  const navigate = useAppNavigate();

  const query = useMemo(() => parseStatsQuery(params), [params]);
  const kind: BillKind = params.get("kind") === "income" ? "income" : "expense";
  const parentId = Number(params.get("parent")) || null;
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
        void logEvent("error", "stats.categories.load.failed", {
          kind,
          from: period.from,
          to: period.to,
          parent_id: parentId,
          message: errorMessage(error),
        });
      });
    return () => {
      alive = false;
    };
  }, [period.from, period.to, reloadKey]);

  const tree = roots ?? [];
  const parent = useMemo(() => {
    if (!parentId || tree.length === 0) return null;
    const cat = findCategory(tree, parentId);
    return cat && cat.kind === kind ? cat : null;
  }, [tree, parentId, kind]);

  const shares = useMemo(() => {
    if (!bills) return [];
    if (parent) return rollupByNodeWithCounts(bills, parent, kind);
    return rollupByTopLevelWithCounts(bills, tree, kind);
  }, [bills, tree, parent, kind]);

  const total = useMemo(
    () => shares.reduce((sum, share) => sum + share.cents, 0),
    [shares],
  );
  const path = useMemo(
    () => (parent ? categoryPath(tree, parent.id) : []),
    [tree, parent],
  );

  const catName = (cat: Category) => (cat.name_key ? t(cat.name_key) : cat.name);

  const openDetail = (cat: Category, exact: boolean) => {
    const detailParams = new URLSearchParams({
      mode: query.mode,
      year: String(query.year),
      kind,
    });
    if (query.mode === "monthly") {
      detailParams.set("month", String(query.month));
    }
    if (exact) detailParams.set("exact", "1");
    navigate(`/stats/category/${cat.id}?${detailParams.toString()}`);
  };

  const loading = !failed && (roots === null || bills === null);

  return (
    <div className="flex h-full flex-col bg-page">
      <PageHeader title={t("stats.categories")} onBack={goBack} />

      <div className="px-4 pb-2 pt-0.5 text-[11px] text-ink-3">
        {path.length > 0 && (
          <span className="block truncate">
            {path.map((cat) => catName(cat)).join(" › ")} ·{" "}
          </span>
        )}
        {periodLabel} · {kindLabel}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {failed ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        ) : loading ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">…</div>
        ) : shares.length === 0 ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">
            {t("common.empty")}
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between px-1 pb-2 pt-1">
              <span className="text-[11px] text-ink-3">
                {t("stats.categories")}
              </span>
              <span className="num text-[12px] text-ink-2">
                <span className="mr-0.5 text-[10px] text-ink-3">¥</span>
                {formatMoneyCompact(total, locale)}
              </span>
            </div>
            <div className="paper overflow-hidden">
              {shares.map((share, index) => {
                const isSelf = Boolean(parent && share.cat.id === parent.id);
                const percent =
                  total > 0 ? Math.round((share.cents / total) * 100) : 0;
                const barPercent = total > 0 ? (share.cents / total) * 100 : 0;
                return (
                  <button
                    key={share.cat.id}
                    type="button"
                    className={cn(
                      "w-full px-3 py-3 text-left transition-colors hover:bg-chip/50 active:bg-chip",
                      index > 0 && "border-t border-line",
                    )}
                    onClick={() => openDetail(share.cat, isSelf)}
                  >
                    <div className="flex items-center">
                      <IconBadge
                        icon={share.cat.icon}
                        iconImage={share.cat.icon_image}
                        nameKey={share.cat.name_key}
                        iconType={share.cat.icon_type}
                      />
                      <div className="ml-2.5 min-w-0 flex-1">
                        <div className="truncate text-[14px] text-ink">
                          {isSelf ? t("stats.selfLevel") : catName(share.cat)}
                        </div>
                        <div className="text-[10px] text-ink-3">
                          {t("stats.billCount", { count: share.count })}
                        </div>
                      </div>
                      <div className="ml-2 shrink-0 text-right">
                        <div
                          className={cn(
                            "num text-[14px] font-medium",
                            kind === "expense" ? "text-expense" : "text-income",
                          )}
                        >
                          {kind === "expense" ? "-" : "+"}
                          {formatMoneyCompact(share.cents, locale)}
                        </div>
                        <div className="num text-[10px] text-ink-3">
                          {percent}%
                        </div>
                      </div>
                      <ChevronRight
                        size={15}
                        strokeWidth={1.8}
                        className="ml-1 shrink-0 text-ink-3"
                      />
                    </div>
                    <div className="mt-2 flex items-center gap-2 pl-[50px]">
                      <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-chip">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            kind === "expense" ? "bg-brand" : "bg-income",
                          )}
                          style={{
                            width: `${Math.max(2, Math.min(100, barPercent))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
