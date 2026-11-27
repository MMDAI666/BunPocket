import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import {
  type BillRow,
  type Category,
  deleteBill,
  getBill,
  loadCategoryRows,
} from "../db";
import { buildCategoryTree, findCategory } from "../lib/category";
import { formatMoneyCompact } from "../lib/format";
import { errorMessage, logEvent } from "../lib/logger";
import { cn } from "../lib/cn";
import { useAppBack } from "../hooks/useAppBack";
import { useAppNavigate } from "../hooks/useAppNavigate";
import { useLocale } from "../hooks/useLocale";
import { PageHeader } from "../components/ui/PageHeader";
import { IconBadge } from "../components/ui/IconBadge";
import { Confirm } from "../components/ui/Confirm";
import { ErrorState } from "../components/ui/ErrorState";
import { toast } from "../components/ui/Toast";

type Status = "loading" | "ready" | "missing" | "error";

interface DetailRowProps {
  label: string;
  value: string;
  /** 时间等数字内容用等宽数字 */
  num?: boolean;
}

function DetailRow({ label, value, num = false }: DetailRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="shrink-0 text-[12px] text-ink-3">{label}</span>
      <span
        className={cn(
          "min-w-0 text-right text-[13px] leading-[1.55] text-ink [overflow-wrap:anywhere]",
          num && "num",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** 账单详情：只读记录卡；删除走顶栏垃圾桶，底部只留「编辑」主操作。 */
export function BillDetail() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { id } = useParams();
  const billId = Number(id) || null;
  const goBack = useAppBack();
  const navigate = useAppNavigate();

  const [status, setStatus] = useState<Status>("loading");
  const [bill, setBill] = useState<BillRow | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** 删除请求期间用户可能已离开本页，成功后的返回不能作用到下一页 */
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setBill(null);
    if (billId == null) {
      setStatus("missing");
      return;
    }
    void (async () => {
      try {
        const [rows, found] = await Promise.all([
          loadCategoryRows(),
          getBill(billId),
        ]);
        if (!alive) return;
        setCategories(buildCategoryTree(rows));
        if (!found) {
          // 记录已被删除/深链写错：按"不存在"处理，不显示空白详情卡
          setStatus("missing");
          return;
        }
        setBill(found);
        setStatus("ready");
      } catch (error) {
        if (!alive) return;
        setStatus("error");
        void logEvent("error", "bill.detail.load.failed", {
          id: billId,
          message: errorMessage(error),
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [billId, reloadKey]);

  const category = bill ? findCategory(categories, bill.category_id) : null;
  const categoryName = category
    ? category.name_key
      ? t(category.name_key)
      : category.name
    : "—";

  const removeBill = async () => {
    if (billId == null || deleting) return;
    setDeleting(true);
    try {
      await deleteBill(billId);
      await logEvent("info", "bill.delete", { id: billId });
      if (mountedRef.current) goBack();
    } catch (error) {
      void logEvent("error", "bill.delete.failed", {
        id: billId,
        message: errorMessage(error),
      });
      if (!mountedRef.current) return;
      setDeleting(false);
      toast.show(t("common.deleteFailed"), "error");
    }
  };

  return (
    <div className="flex h-full flex-col bg-page">
      <PageHeader
        title={t("billDetail.title")}
        onBack={goBack}
        right={
          status === "ready" ? (
            <button
              type="button"
              disabled={deleting}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-chip active:bg-chip disabled:opacity-50"
              onClick={() => setConfirmDelete(true)}
              aria-label={t("common.delete")}
            >
              <Trash2 size={18} strokeWidth={1.8} />
            </button>
          ) : undefined
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1.5 pb-5">
        {status === "error" ? (
          <ErrorState onRetry={() => setReloadKey((key) => key + 1)} />
        ) : status === "missing" ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">
            {t("common.empty")}
          </div>
        ) : status !== "ready" || !bill ? (
          <div className="paper py-12 text-center text-[13px] text-ink-3">…</div>
        ) : (
          // .paper 是无 layer 的自定义规则，border-radius 会压过 utilities
          // 层的 rounded-[18px]；这里用内联样式匹配原型的 .detail-card 18px。
          <div
            className="paper px-5 pt-[22px] pb-3 text-center"
            style={{ borderRadius: 18 }}
          >
            <div className="flex justify-center" aria-hidden="true">
              <IconBadge
                icon={category?.icon}
                iconImage={category?.icon_image}
                nameKey={category?.name_key}
                iconType={category?.icon_type}
                size="lg"
                className="h-[60px] w-[60px] rounded-full text-[28px]"
              />
            </div>
            <div className="mt-2.5 text-[15px] font-semibold text-ink">
              {categoryName}
            </div>
            <div className="mt-4 mb-3.5 h-px bg-line" />
            <div className="text-[11px] text-ink-3">
              {t("billDetail.amount")}
            </div>
            <div
              className={cn(
                "num mt-1.5 text-[34px] font-bold leading-[1.1] tracking-[-0.035em]",
                bill.kind === "expense" ? "text-expense" : "text-income",
              )}
            >
              {bill.kind === "expense" ? "-" : "+"}¥
              {formatMoneyCompact(bill.amount_cents, locale)}
            </div>
            <div className="mt-4 text-left">
              <DetailRow
                label={t("billDetail.kind")}
                value={t(
                  bill.kind === "expense" ? "add.expense" : "add.income",
                )}
              />
              <DetailRow
                label={t("billDetail.time")}
                value={`${bill.date} ${bill.time}`}
                num
              />
              <DetailRow
                label={t("billDetail.note")}
                value={bill.note || t("billDetail.noNote")}
              />
              {bill.kind === "expense" && (
                <DetailRow
                  label={t("billDetail.budget")}
                  value={
                    bill.exclude_budget
                      ? t("add.excludeBudget")
                      : t("billDetail.inBudget")
                  }
                />
              )}
            </div>
          </div>
        )}
      </div>

      {status === "ready" && bill && (
        <div className="flex shrink-0 justify-center px-4 pt-2.5 pb-[calc(22px+env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={deleting}
            className="h-11 min-w-[148px] rounded-full bg-book px-6 text-[14px] font-semibold text-cream transition-[background-color,scale] duration-150 hover:bg-book-deep active:scale-[0.98] disabled:opacity-50"
            onClick={() => navigate(`/add?id=${bill.id}`)}
          >
            {t("common.edit")}
          </button>
        </div>
      )}

      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("bills.deleteBillTitle")}
        content={t("bills.deleteBillContent")}
        danger
        onConfirm={() => void removeBill()}
      />
    </div>
  );
}
