import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppBack } from "../hooks/useAppBack";
import { useTranslation } from "react-i18next";
import {
  type BillKind,
  type Category,
  deleteBill,
  getBill,
  insertBill,
  loadCategoryRows,
  updateBill,
} from "../db";
import { buildCategoryTree, categoryPath } from "../lib/category";
import { nowTimeStr, todayStr } from "../lib/format";
import { exprToCents } from "../lib/money";
import { cn } from "../lib/cn";
import { Segmented } from "../components/ui/Segmented";
import { Sheet } from "../components/ui/Sheet";
import { Confirm } from "../components/ui/Confirm";
import { MonthCalendar } from "../components/ui/MonthCalendar";
import { TimePicker } from "../components/ui/TimePicker";
import { NumberPad } from "../components/ui/NumberPad";
import { IconBadge } from "../components/ui/IconBadge";
import { toast } from "../components/ui/Toast";
import { useLocale } from "../hooks/useLocale";

export function AddBill() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const goBack = useAppBack();
  const [searchParams] = useSearchParams();
  const editId = Number(searchParams.get("id")) || null;

  const [roots, setRoots] = useState<Category[] | null>(null);
  const [kind, setKind] = useState<BillKind>("expense");
  const [selectedPath, setSelectedPath] = useState<Category[]>([]);
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState(nowTimeStr());
  const [note, setNote] = useState("");
  const [excludeBudget, setExcludeBudget] = useState(false);
  const [expr, setExpr] = useState("");

  const [dateOpen, setDateOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await loadCategoryRows();
        if (!alive) return;
        const tree = buildCategoryTree(rows);
        setRoots(tree);
        if (editId) {
          const bill = await getBill(editId);
          if (!bill || !alive) return;
          setKind(bill.kind);
          setDate(bill.date);
          setTime(bill.time);
          setNote(bill.note ?? "");
          setExcludeBudget(Boolean(bill.exclude_budget));
          setExpr(String(bill.amount_cents / 100));
          setSelectedPath(categoryPath(tree, bill.category_id));
        }
      } catch {
        if (alive) setRoots([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [editId]);

  const visibleRoots = useMemo(
    () => (roots ?? []).filter((c) => !c.hidden && c.kind === kind),
    [roots, kind],
  );

  const current = selectedPath[selectedPath.length - 1] ?? null;
  const children = current?.children.filter((c) => !c.hidden) ?? [];
  const cents = exprToCents(expr);

  const changeKind = (next: BillKind) => {
    setKind(next);
    setSelectedPath([]);
  };

  const save = async (thenNew: boolean) => {
    if (!current) {
      toast.show(t("add.selectCategoryFirst"), "error");
      return;
    }
    if (cents == null) return;
    const payload = {
      amount_cents: cents,
      kind,
      category_id: current.id,
      note: note.trim() || null,
      exclude_budget: excludeBudget,
      date,
      time,
    };
    try {
      if (editId) {
        await updateBill(editId, payload);
      } else {
        await insertBill(payload);
      }
      if (thenNew && !editId) {
        setExpr("");
        setNote("");
        toast.show(t("add.savedAndNew"));
      } else {
        toast.show(t("add.saved"));
        navigate("/", { replace: true });
      }
    } catch {
      toast.show(t("common.saveFailed"), "error");
    }
  };

  if (roots === null) {
    return <div className="h-full bg-page" />;
  }

  return (
    <div className="flex h-full flex-col bg-card">
      {/* 顶栏 */}
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
          {t("nav.add")}
        </div>
        {editId ? (
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full text-ink active:bg-chip"
            onClick={() => setConfirmDelete(true)}
            aria-label={t("common.delete")}
          >
            🗑
          </button>
        ) : (
          <div className="w-10" />
        )}
      </div>

      <div className="px-4 pb-2">
        <Segmented
          options={[
            { value: "expense", label: t("add.expense") },
            { value: "income", label: t("add.income") },
          ]}
          value={kind}
          onChange={changeKind}
        />
      </div>

      {/* 中部可滚动：分类宫格（面包屑与子分类 chips 在滚动区外的固定条，避免被宫格挤到折叠线以下） */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="grid grid-cols-4 py-2">
          {visibleRoots.map((cat) => {
            const selected = selectedPath[0]?.id === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                className="flex flex-col items-center gap-1 py-2"
                onClick={() => setSelectedPath([cat])}
              >
                <div className="relative">
                  <IconBadge
                    icon={cat.icon}
                    iconImage={cat.icon_image}
                    nameKey={cat.name_key}
                    iconType={cat.icon_type}
                    size="lg"
                    className={cn(selected && "ring-2 ring-brand ring-offset-2 ring-offset-card")}
                  />
                  {selected && (
                    <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] text-white">
                      ✓
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    "max-w-full truncate text-xs",
                    selected ? "font-medium text-ink" : "text-ink-2",
                  )}
                >
                  {cat.name_key ? t(cat.name_key) : cat.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 固定子分类条：面包屑 + 子分类 chips，位于宫格与元信息行之间，恒定可见 */}
      {(selectedPath.length > 1 || children.length > 0) && (
        <div className="flex flex-col gap-1 border-t border-line px-4 py-2">
          {selectedPath.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 text-xs text-ink-3">
              {selectedPath.map((node, i) => (
                <span key={node.id} className="flex items-center gap-1">
                  {i > 0 && <span>›</span>}
                  <button
                    type="button"
                    className="rounded px-1 py-0.5 text-ink-2 active:bg-chip"
                    onClick={() => setSelectedPath(selectedPath.slice(0, i + 1))}
                  >
                    {node.name_key ? t(node.name_key) : node.name}
                  </button>
                </span>
              ))}
            </div>
          )}
          {children.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {children.map((child) => {
                const active = current?.id === child.id;
                return (
                  <button
                    key={child.id}
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs",
                      active
                        ? "bg-gradient-to-r from-brand-1 to-brand-2 text-white"
                        : "bg-chip text-ink-2",
                    )}
                    onClick={() => setSelectedPath([...selectedPath, child])}
                  >
                    <IconBadge icon={child.icon} iconImage={child.icon_image} nameKey={child.name_key} iconType={child.icon_type} size="sm" iconSize={14} className="h-5 w-5 text-sm" />
                    {child.name_key ? t(child.name_key) : child.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 固定底部区：元信息行 + 金额显示 + 数字键盘 */}
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          type="button"
          className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs text-ink-2"
          onClick={() => setDateOpen(true)}
        >
          {date === todayStr() ? t("add.dateToday") : date}
        </button>
        <button
          type="button"
          className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs text-ink-2"
          onClick={() => setTimeOpen(true)}
        >
          {time}
        </button>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("add.notePlaceholder")}
          className="min-w-0 flex-1 rounded-full border border-line px-3 py-1.5 text-xs text-ink outline-none placeholder:text-ink-3 focus:border-brand"
        />
        <button
          type="button"
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs",
            excludeBudget
              ? "border-brand bg-brand/10 font-medium text-brand"
              : "border-line text-ink-3",
          )}
          onClick={() => setExcludeBudget((v) => !v)}
        >
          {t("add.excludeBudget")}
        </button>
      </div>

      {/* 金额显示区 */}
      <div className="flex min-h-14 flex-col items-end justify-center px-4 pb-1">
        {expr === "" ? (
          <span className="text-2xl font-light text-ink-3">
            {t("add.amountPlaceholder")}
          </span>
        ) : (
          <span className="max-w-full truncate text-3xl font-light text-ink">
            <span className="mr-1 text-lg align-top">¥</span>
            {expr}
          </span>
        )}
      </div>

      <NumberPad
        value={expr}
        onChange={setExpr}
        onSubmit={() => void save(false)}
        submitDisabled={cents == null || !current}
        onAnother={() => void save(true)}
      />

      {/* 日期 / 时间 / 备注历史 弹层 */}
      <Sheet open={dateOpen} onOpenChange={setDateOpen} title={t("add.pickDate")}>
        <MonthCalendar
          value={date}
          onChange={(next) => {
            setDate(next);
            setDateOpen(false);
          }}
          locale={locale}
        />
      </Sheet>
      <Sheet open={timeOpen} onOpenChange={setTimeOpen}>
        <TimePicker value={time} onChange={setTime} />
      </Sheet>

      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("bills.deleteBillTitle")}
        content={t("bills.deleteBillContent")}
        danger
        onConfirm={() => {
          if (editId) {
            void deleteBill(editId).then(() => navigate("/", { replace: true }));
          }
        }}
      />
    </div>
  );
}
