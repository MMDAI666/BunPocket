import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppBack } from "../hooks/useAppBack";
import { useTranslation } from "react-i18next";
import { BanknoteX, Check } from "lucide-react";
import {
  type BillKind,
  type Category,
  getBill,
  insertBill,
  loadCategoryRows,
  recentNotesByCategory,
  updateBill,
} from "../db";
import { getHiddenNotes, hideNote, unhideNote } from "../lib/notes";
import { errorMessage, logEvent } from "../lib/logger";
import { buildCategoryTree, categoryPath } from "../lib/category";
import {
  dateStrFromMs,
  localDateTimeToMs,
  nowTimeStr,
  timeStrFromMs,
  todayStr,
} from "../lib/format";
import { exprToCents, pressKey, type PadKey } from "../lib/money";
import { cn } from "../lib/cn";
import { Segmented } from "../components/ui/Segmented";
import { Sheet } from "../components/ui/Sheet";
import { MonthCalendar } from "../components/ui/MonthCalendar";
import { TimePicker } from "../components/ui/TimePicker";
import { NumberPad } from "../components/ui/NumberPad";
import { NoteTag } from "../components/ui/NoteTag";
import { IconBadge } from "../components/ui/IconBadge";
import { ErrorState } from "../components/ui/ErrorState";
import { PageHeader } from "../components/ui/PageHeader";
import { toast } from "../components/ui/Toast";
import { useLocale } from "../hooks/useLocale";

/** 分 → 键盘表达式数字：最多两位小数、去掉多余的 0（与 exprToCents 同一套金额口径） */
function centsToExpr(cents: number): string {
  return String(cents / 100);
}

export function AddBill() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const goBack = useAppBack();
  const [searchParams] = useSearchParams();
  const editId = Number(searchParams.get("id")) || null;

  const [roots, setRoots] = useState<Category[] | null>(null);
  const [kind, setKind] = useState<BillKind>("expense");
  const [selectedPath, setSelectedPath] = useState<Category[]>([]);
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState(nowTimeStr());
  /** 编辑时保留的原始毫秒：日期/时间未改时原样写回，避免秒/毫秒被 UI 分钟精度截断 */
  const [originalOccurredAtMs, setOriginalOccurredAtMs] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [excludeBudget, setExcludeBudget] = useState(false);
  const [expr, setExpr] = useState("");
  /** 刚按过「＝」：下个数字/小数点重开一笔，下个运算符从结果续算（镜像原型 amountEvaluated） */
  const afterEquals = useRef(false);
  const [noteSuggestions, setNoteSuggestions] = useState<string[]>([]);
  /** 保存后刷新备注候选（最近使用排序会变化） */
  const [notesReloadKey, setNotesReloadKey] = useState(0);

  const [dateOpen, setDateOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    (async () => {
      try {
        const rows = await loadCategoryRows();
        if (!alive) return;
        const tree = buildCategoryTree(rows);
        setRoots(tree);
        if (editId) {
          const bill = await getBill(editId);
          if (!alive) return;
          if (!bill) {
            // 编辑目标不存在（记录已删/脏链接）：按加载失败处理，避免进入空白表单
            setFailed(true);
            return;
          }
          setKind(bill.kind);
          setDate(bill.date);
          setTime(bill.time);
          setOriginalOccurredAtMs(bill.occurred_at_ms);
          setNote(bill.note ?? "");
          setExcludeBudget(Boolean(bill.exclude_budget));
          setExpr(centsToExpr(bill.amount_cents));
          setSelectedPath(categoryPath(tree, bill.category_id));
        }
      } catch (error) {
        void logEvent("error", "add.load.failed", {
          editId,
          message: errorMessage(error),
        });
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [editId, reloadKey]);

  const visibleRoots = useMemo(
    () => (roots ?? []).filter((c) => !c.hidden && c.kind === kind),
    [roots, kind],
  );

  const current = selectedPath[selectedPath.length - 1] ?? null;
  const children = current?.children.filter((c) => !c.hidden) ?? [];
  const cents = exprToCents(expr);
  /** 算式含运算符且不是尾随运算符时，主键先当「＝」：算出结果后才恢复「确定」 */
  const pendingEquals = /[+-]/.test(expr) && !/[+-]$/.test(expr);

  // 备注候选跟随当前选中的分类本身（不混入父/子分类）；未选分类时不展示候选
  const noteCategoryId = current?.id ?? null;
  useEffect(() => {
    let alive = true;
    if (noteCategoryId == null) {
      setNoteSuggestions([]);
      return;
    }
    void (async () => {
      try {
        const hidden = await getHiddenNotes();
        const notes = await recentNotesByCategory(
          noteCategoryId,
          8,
          hidden,
        );
        if (alive) setNoteSuggestions(notes);
      } catch {
        if (alive) setNoteSuggestions([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [noteCategoryId, notesReloadKey]);

  /** 长按粉碎：只把标签移出候选（历史账单的备注文字保持原样） */
  const shatterNote = async (suggestion: string) => {
    if (noteCategoryId == null) return;
    try {
      await hideNote(suggestion);
      setNoteSuggestions((prev) =>
        prev.filter((item) => item !== suggestion),
      );
      await logEvent("info", "note.hide", {
        note: suggestion,
        category_id: noteCategoryId,
      });
      toast.show(t("add.noteRemoved"));
    } catch (error) {
      void logEvent("error", "note.hide.failed", {
        note: suggestion,
        message: errorMessage(error),
      });
      toast.show(t("common.saveFailed"), "error");
    }
  };

  const changeKind = (next: BillKind) => {
    setKind(next);
    setSelectedPath([]);
  };

  /** 保存后返回上一页；没有应用内历史时才 replace 回首页（避免历史栈出现两个 Home） */
  const finish = () => {
    goBack();
  };

  const save = async (thenNew: boolean) => {
    if (saving) return;
    if (!current) {
      toast.show(t("add.selectCategoryFirst"), "error");
      return;
    }
    if (cents == null) {
      // OK 按钮在无效金额时是禁用的；「再记」需要显式提示，避免点了没反应
      if (expr.trim() !== "") toast.show(t("common.invalidAmount"), "error");
      return;
    }
    const keepOriginal =
      editId != null &&
      originalOccurredAtMs != null &&
      dateStrFromMs(originalOccurredAtMs) === date &&
      timeStrFromMs(originalOccurredAtMs) === time;
    const occurred_at_ms =
      keepOriginal && originalOccurredAtMs != null
        ? originalOccurredAtMs
        : localDateTimeToMs(date, time);
    const payload = {
      amount_cents: cents,
      kind,
      category_id: current.id,
      note: note.trim() || null,
      // 收入账单没有"不计入预算"语义，统一存 false
      exclude_budget: kind === "expense" ? excludeBudget : false,
      occurred_at_ms,
    };
    const savedNote = note.trim();
    setSaving(true);
    try {
      const logDetail = {
        amount_cents: payload.amount_cents,
        kind: payload.kind,
        category_id: payload.category_id,
        note: payload.note,
        exclude_budget: payload.exclude_budget,
        date,
        time,
        occurred_at_ms,
      };
      if (editId) {
        await updateBill(editId, payload);
        await logEvent("info", "bill.update", { id: editId, ...logDetail });
      } else {
        const id = await insertBill(payload);
        await logEvent("info", "bill.add", { id, ...logDetail });
      }
      // 重新主动使用这条备注后，让它回到候选里
      if (savedNote) {
        await unhideNote(savedNote).catch(() => {
          /* 候选状态失败不影响保存 */
        });
      }
      setNotesReloadKey((key) => key + 1);
      if (thenNew && !editId) {
        setExpr("");
        setNote("");
        afterEquals.current = false;
        toast.show(t("add.savedAndNew"));
      } else {
        toast.show(t("add.saved"));
        finish();
      }
    } catch (error) {
      void logEvent("error", "bill.save.failed", {
        id: editId ?? null,
        message: errorMessage(error),
      });
      toast.show(t("common.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  /**
   * 键盘「＝」两段行为：算式可求值时先算出结果并把主键恢复为「确定」，
   * 再点一次才保存（金额口径与 exprToCents 一致）。
   */
  const submit = () => {
    if (saving) return;
    if (!pendingEquals) {
      void save(false);
      return;
    }
    if (cents == null) return;
    setExpr(centsToExpr(cents));
    afterEquals.current = true;
  };

  /** 「＝」之后：数字/小数点重开一笔，运算符从结果续算，退格照常编辑 */
  const changeExpr = (next: string, key: PadKey) => {
    if (!afterEquals.current) {
      setExpr(next);
      return;
    }
    afterEquals.current = false;
    if (key === "+" || key === "-" || key === "back") {
      setExpr(next);
      return;
    }
    // 数字/小数点：忽略结果已占满小数位/位数时的键盘限制，等价于从空算式重新输入
    setExpr(pressKey("", key));
  };

  if (roots === null || failed) {
    return (
      <div className="flex h-full flex-col bg-page">
        <PageHeader
          title={editId ? t("billDetail.editTitle") : t("nav.add")}
          onBack={goBack}
        />
        <div className="px-4 pt-4">
          {failed ? (
            <ErrorState
              onRetry={() => {
                setFailed(false);
                setRoots(null);
                setReloadKey((k) => k + 1);
              }}
            />
          ) : (
            <div className="paper py-12 text-center text-[13px] text-ink-3">
              …
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-card">
      <PageHeader
        title={editId ? t("billDetail.editTitle") : t("nav.add")}
        onBack={goBack}
      />

      <div className="px-4 pb-2 pt-1">
        <Segmented
          options={[
            { value: "expense", label: t("add.expense") },
            { value: "income", label: t("add.income") },
          ]}
          value={kind}
          onChange={changeKind}
        />
      </div>

      {/* 中部可滚动：分类宫格（面包屑与子分类 chips 在滚动区外的固定条） */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="grid grid-cols-4 gap-y-1 py-2">
          {visibleRoots.map((cat) => {
            const selected = selectedPath[0]?.id === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                className="flex flex-col items-center gap-1.5 py-2"
                onClick={() => setSelectedPath([cat])}
              >
                <div className="relative">
                  <IconBadge
                    icon={cat.icon}
                    iconImage={cat.icon_image}
                    nameKey={cat.name_key}
                    iconType={cat.icon_type}
                    size="lg"
                    className={cn(
                      "transition-shadow",
                      selected &&
                        "ring-2 ring-book ring-offset-2 ring-offset-card",
                    )}
                  />
                  {selected && (
                    <span className="absolute -top-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-book text-cream ring-2 ring-card">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    "max-w-full truncate text-[11px]",
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

      {/* 固定子分类条：面包屑 + 子分类 chips */}
      {(selectedPath.length > 1 || children.length > 0) && (
        <div className="flex flex-col gap-1.5 border-t border-line px-4 py-2">
          {selectedPath.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-ink-3">
              {selectedPath.map((node, i) => (
                <span key={node.id} className="flex items-center gap-1">
                  {i > 0 && <span className="text-ink-3">›</span>}
                  <button
                    type="button"
                    className="rounded-[6px] px-1 py-0.5 text-ink-2 transition-colors hover:bg-chip"
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
                      "flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-[11px] transition-colors",
                      active
                        ? "border-brand-soft bg-brand-soft text-brand"
                        : "border-line bg-card text-ink-2 hover:bg-chip",
                    )}
                    onClick={() => setSelectedPath([...selectedPath, child])}
                  >
                    <IconBadge
                      icon={child.icon}
                      iconImage={child.icon_image}
                      nameKey={child.name_key}
                      iconType={child.icon_type}
                      size="sm"
                      iconSize={13}
                      className={cn(
                        "h-5 w-5 border-0 text-[13px]",
                        active ? "bg-cream/15" : "bg-chip",
                      )}
                    />
                    {child.name_key ? t(child.name_key) : child.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 固定底部区：日期 / 时间 / 不计预算 + 备注 + 金额 + 键盘 */}
      <div className="border-t border-line">
        <div className="flex items-center gap-2 px-4 pt-2.5">
          <button
            type="button"
            className="shrink-0 rounded-[9px] border border-line px-2.5 py-1.5 text-[11px] text-ink-2 transition-colors hover:bg-chip"
            onClick={() => setDateOpen(true)}
          >
            {date === todayStr() ? t("add.dateToday") : date}
          </button>
          <button
            type="button"
            className="shrink-0 rounded-[9px] border border-line px-2.5 py-1.5 text-[11px] text-ink-2 transition-colors hover:bg-chip"
            onClick={() => setTimeOpen(true)}
          >
            {time}
          </button>
          {kind === "expense" && (
            <button
              type="button"
              className={cn(
                "ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border transition-colors",
                excludeBudget
                  ? "border-book bg-brand-soft text-brand"
                  : "border-line text-ink-3 hover:bg-chip",
              )}
              aria-label={t("add.excludeBudget")}
              aria-pressed={excludeBudget}
              title={t("add.excludeBudget")}
              onClick={() => setExcludeBudget((v) => !v)}
            >
              <BanknoteX size={15} strokeWidth={1.9} />
            </button>
          )}
        </div>

        <div className="px-4 pt-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("add.notePlaceholder")}
            aria-label={t("add.notePlaceholder")}
            className="w-full rounded-[9px] border border-line bg-card px-3 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-brand"
          />
        </div>

        {/* 备注候选：跟随当前选中的分类本身；长按粉碎只把标签移出候选 */}
        {note === "" && noteSuggestions.length > 0 && (
          <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto px-4 pt-1.5">
            {noteSuggestions.map((suggestion) => (
              <NoteTag
                key={suggestion}
                note={suggestion}
                onPick={setNote}
                onShatter={(target) => void shatterNote(target)}
              />
            ))}
          </div>
        )}

        <div className="flex min-h-[64px] items-end justify-end px-5 pb-2 pt-1">
          {expr === "" ? (
            <span className="text-[22px] font-light text-ink-3">
              {t("add.amountPlaceholder")}
            </span>
          ) : (
            <span className="num max-w-full truncate text-[38px] leading-none font-semibold tracking-[-0.04em] text-ink">
              <span className="mr-1 align-top text-[18px] font-medium text-ink-2">
                ¥
              </span>
              {expr}
            </span>
          )}
        </div>
      </div>

      <NumberPad
        value={expr}
        onChange={changeExpr}
        submitLabel={pendingEquals ? "＝" : undefined}
        onSubmit={submit}
        submitDisabled={saving || cents == null || !current}
        onAnother={() => void save(true)}
      />

      {/* 日期 / 时间 弹层 */}
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
      <Sheet open={timeOpen} onOpenChange={setTimeOpen} title={t("add.pickTime")}>
        <TimePicker value={time} onChange={setTime} />
      </Sheet>
    </div>
  );
}
