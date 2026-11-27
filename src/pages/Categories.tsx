import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppBack } from "../hooks/useAppBack";
import { useTranslation } from "react-i18next";
import {
  type BillKind,
  type Category,
  categoryDeleteBlocker,
  deleteCategory,
  insertCategory,
  loadCategoryRows,
  reorderCategoryGroup,
  updateCategory,
} from "../db";
import { applySiblingOrder, buildCategoryTree } from "../lib/category";
import { fileToIconDataUrl } from "../lib/image";
import { errorMessage, logEvent } from "../lib/logger";
import { cn } from "../lib/cn";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Image as ImageIcon,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "../components/ui/Toast";
import { CategorySortTree } from "../components/CategorySortTree";
import { Segmented } from "../components/ui/Segmented";
import { Sheet } from "../components/ui/Sheet";
import { Confirm } from "../components/ui/Confirm";
import { ErrorState } from "../components/ui/ErrorState";
import { IconBadge } from "../components/ui/IconBadge";
import { EmojiPicker } from "../components/ui/EmojiPicker";
import { PageHeader } from "../components/ui/PageHeader";

type SheetAction = "add" | "rename" | "icon" | "more" | null;

export function Categories() {
  const { t } = useTranslation();
  const goBack = useAppBack();
  const [kind, setKind] = useState<BillKind>("expense");
  const [roots, setRoots] = useState<Category[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sortMode, setSortMode] = useState(false);
  const [sortBusy, setSortBusy] = useState(false);
  const [target, setTarget] = useState<Category | null>(null);
  const [sheet, setSheet] = useState<SheetAction>(null);
  const [nameValue, setNameValue] = useState("");
  const [newIcon, setNewIcon] = useState<{ icon: string; image: string | null }>({
    icon: "🏷️",
    image: null,
  });
  const [iconForNew, setIconForNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    try {
      setRoots(buildCategoryTree(await loadCategoryRows()));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      void logEvent("error", "categories.load.failed", {
        message: errorMessage(error),
      });
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const displayName = (cat: Category) =>
    cat.name_key ? t(cat.name_key) : cat.name;

  const visibleRoots = (roots ?? []).filter((cat) => cat.kind === kind);

  /** 收集一棵树里所有「有子分类」的节点：排序模式默认把它们全展开 */
  const expandableIds = (cats: Category[]): Set<number> => {
    const ids = new Set<number>();
    const walk = (nodes: Category[]) => {
      for (const node of nodes) {
        if (node.children.length > 0) {
          ids.add(node.id);
          walk(node.children);
        }
      }
    };
    walk(cats);
    return ids;
  };

  const enterSortMode = () => {
    setSheet(null);
    setTarget(null);
    setConfirmDelete(false);
    setSortMode(true);
    // 默认全展开：二级分类也要能拖，先把层级摊开（用户仍可点行收起）
    setExpanded(expandableIds(visibleRoots));
  };

  const changeKind = (next: BillKind) => {
    setKind(next);
    if (sortMode) {
      setExpanded(
        expandableIds((roots ?? []).filter((cat) => cat.kind === next)),
      );
    }
  };

  /**
   * 拖动结束后落库：先按新顺序乐观更新本地树（拖完立即贴合手势），
   * 写库失败则 toast + 重新加载，用数据库真实顺序覆盖，不留下假的顺序。
   */
  const doReorder = async (parentId: number | null, orderedIds: number[]) => {
    if (sortBusy) return;
    setSortBusy(true);
    setRoots((prev) =>
      prev ? applySiblingOrder(prev, parentId, orderedIds) : prev,
    );
    try {
      await reorderCategoryGroup(parentId, orderedIds);
      await logEvent("info", "category.reorder", {
        parent_id: parentId,
        ids: orderedIds,
      });
    } catch (error) {
      void logEvent("error", "category.reorder.failed", {
        parent_id: parentId,
        message: errorMessage(error),
      });
      toast.show(t("common.saveFailed"), "error");
      await reload();
    } finally {
      setSortBusy(false);
    }
  };

  const openSheet = (cat: Category | null, action: SheetAction) => {
    setTarget(cat);
    setSheet(action);
    setIconForNew(false);
    if (action === "rename" && cat) setNameValue(displayName(cat));
    if (action === "add") {
      setNameValue("");
      setNewIcon(
        cat
          ? { icon: cat.icon, image: cat.icon_image }
          : { icon: "🏷️", image: null },
      );
    }
  };

  const closeSheet = () => {
    setSheet(null);
    setTarget(null);
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const doSaveName = async () => {
    if (busy) return;
    const name = nameValue.trim();
    if (!name) return;
    setBusy(true);
    try {
      if (sheet === "add") {
        if (target) {
          const id = await insertCategory({
            parent_id: target.id,
            name,
            icon: newIcon.icon,
            icon_image: newIcon.image,
            icon_type: newIcon.image ? "image" : "emoji",
            kind: target.kind,
          });
          await logEvent("info", "category.add", {
            id,
            parent_id: target.id,
            name,
            kind: target.kind,
          });
          setExpanded((prev) => new Set(prev).add(target.id));
        } else {
          const id = await insertCategory({
            parent_id: null,
            name,
            icon: newIcon.icon,
            icon_image: newIcon.image,
            icon_type: newIcon.image ? "image" : "emoji",
            kind,
          });
          await logEvent("info", "category.add", {
            id,
            parent_id: null,
            name,
            kind,
          });
        }
      } else if (sheet === "rename" && target) {
        // 原样保存（未改名）不能清空 name_key，否则系统分类会丢本地化名与默认 SVG 图标
        if (name === displayName(target)) {
          closeSheet();
          return;
        }
        const previousName = target.name;
        await updateCategory(target.id, { name, name_key: null });
        await logEvent("info", "category.rename", {
          id: target.id,
          from: previousName,
          to: name,
        });
      }
      closeSheet();
      await reload();
    } catch (error) {
      void logEvent("error", "category.save.failed", {
        sheet,
        target_id: target?.id ?? null,
        name,
        message: errorMessage(error),
      });
      toast.show(t("common.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      const blocker = await categoryDeleteBlocker(target.id);
      if (blocker === "children") {
        toast.show(t("categories.hasChildren"), "error");
        return;
      }
      if (blocker === "bills") {
        toast.show(t("categories.hasBills"), "error");
        return;
      }
      await deleteCategory(target.id);
      await logEvent("info", "category.delete", {
        id: target.id,
        name: target.name,
        kind: target.kind,
      });
      closeSheet();
      await reload();
    } catch (error) {
      void logEvent("error", "category.delete.failed", {
        id: target?.id ?? null,
        message: errorMessage(error),
      });
      toast.show(t("common.deleteFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  /** 写分类后统一收口：防连点 + 失败提示 + 重新加载 */
  const runUpdate = async (
    fn: () => Promise<void>,
    detail?: Record<string, unknown>,
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await logEvent("info", "category.update", {
        id: target?.id ?? null,
        ...detail,
      });
      await reload();
    } catch (error) {
      void logEvent("error", "category.update.failed", {
        id: target?.id ?? null,
        ...detail,
        message: errorMessage(error),
      });
      toast.show(t("common.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await fileToIconDataUrl(file);
      if (iconForNew) {
        setNewIcon({ icon: "", image: dataUrl });
        setSheet("add");
        return;
      }
      if (target) {
        await runUpdate(
          async () => {
            await updateCategory(target.id, {
              icon_image: dataUrl,
              icon_type: "image",
            });
            closeSheet();
          },
          { change: "icon", icon_type: "image" },
        );
      }
    } catch (error) {
      void logEvent("error", "category.icon.failed", {
        id: target?.id ?? null,
        change: "icon",
        message: errorMessage(error),
      });
      toast.show(t("common.saveFailed"), "error");
    }
  };

  const renderRow = (cat: Category, depth: number): ReactNode => (
    <div key={cat.id}>
      <div
        className={cn(
          "flex items-center px-3 py-2.5 transition-colors hover:bg-chip/40",
          cat.hidden === 1 && "opacity-45",
        )}
        style={{ paddingLeft: 12 + Math.min(depth, 4) * 18 }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center text-left"
          aria-expanded={cat.children.length > 0 ? expanded.has(cat.id) : undefined}
          onClick={() => cat.children.length > 0 && toggleExpand(cat.id)}
        >
          <IconBadge icon={cat.icon} iconImage={cat.icon_image} nameKey={cat.name_key} iconType={cat.icon_type} />
          <span className="ml-2 min-w-0 flex-1 truncate text-[14px] text-ink">
            {displayName(cat)}
          </span>
          {cat.is_system === 1 && depth === 0 && (
            <span className="ml-1.5 rounded-[4px] border border-line px-1.5 py-0.5 text-[9px] text-ink-3">
              {t("categories.systemCategory")}
            </span>
          )}
          {cat.children.length > 0 && (
            <span className="ml-1 flex items-center gap-0.5 text-[10px] text-ink-3">
              {expanded.has(cat.id) ? (
                <ChevronDown size={12} strokeWidth={1.9} />
              ) : (
                <ChevronRight size={12} strokeWidth={1.9} />
              )}
              {cat.children.length}
            </span>
          )}
        </button>
        <button
          type="button"
          className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-chip active:bg-chip"
          onClick={() => openSheet(cat, "add")}
          aria-label={t("categories.addChild")}
        >
          <Plus size={15} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-chip active:bg-chip"
          onClick={() => openSheet(cat, "more")}
          aria-label={t("common.edit")}
        >
          <MoreHorizontal size={16} strokeWidth={2} />
        </button>
      </div>
      {expanded.has(cat.id) && cat.children.map((child) => renderRow(child, depth + 1))}
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-page">
      <PageHeader
        title={t("categories.title")}
        onBack={sortMode ? () => setSortMode(false) : goBack}
        right={
          <button
            type="button"
            disabled={!sortMode && (roots === null || failed)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-chip active:bg-chip disabled:opacity-40"
            onClick={() => (sortMode ? setSortMode(false) : enterSortMode())}
            aria-label={
              sortMode ? t("categories.sortDone") : t("categories.sort")
            }
            aria-pressed={sortMode}
          >
            {sortMode ? (
              <Check size={18} strokeWidth={2} />
            ) : (
              <ArrowUpDown size={17} strokeWidth={1.9} />
            )}
          </button>
        }
      />

      <div className="px-3 pb-2 pt-1">
        <Segmented
          options={[
            { value: "expense", label: t("add.expense") },
            { value: "income", label: t("add.income") },
          ]}
          value={kind}
          onChange={changeKind}
        />
      </div>

      {sortMode && (
        <div className="px-3 pb-2 text-[11px] leading-relaxed text-ink-3">
          {t("categories.sortHint")}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {failed ? (
          <div className="px-3">
            <ErrorState onRetry={() => void reload()} />
          </div>
        ) : (
          <>
            <div className="paper mx-3 overflow-hidden">
              {roots === null ? (
                <div className="py-12 text-center text-[13px] text-ink-3">…</div>
              ) : visibleRoots.length === 0 ? (
                <div className="py-12 text-center text-[13px] text-ink-3">
                  {t("common.empty")}
                </div>
              ) : sortMode ? (
                <CategorySortTree
                  roots={visibleRoots}
                  expanded={expanded}
                  disabled={sortBusy}
                  onToggleExpand={toggleExpand}
                  onReorder={(parentId, orderedIds) =>
                    void doReorder(parentId, orderedIds)
                  }
                />
              ) : (
                visibleRoots.map((cat) => renderRow(cat, 0))
              )}
            </div>

            {!sortMode && (
              <div className="mx-3 mt-2.5">
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-line bg-card py-3 text-[12px] text-ink-2 transition-colors hover:bg-chip/40 active:bg-chip"
                  onClick={() => openSheet(null, "add")}
                >
                  <Plus size={15} strokeWidth={2} />
                  {t("categories.addTopLevel")}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 新增（一级 / 子分类，按 target 是否存在区分） */}
      <Sheet
        open={sheet === "add"}
        onOpenChange={(v) => !v && closeSheet()}
        title={
          target
            ? `${t("categories.addChild")} · ${displayName(target)}`
            : t("categories.addTopLevel")
        }
        footer={
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="shrink-0 rounded-full active:scale-95"
              onClick={() => {
                setIconForNew(true);
                setSheet("icon");
              }}
              aria-label={t("categories.changeIcon")}
            >
              <IconBadge icon={newIcon.icon} iconImage={newIcon.image} />
            </button>
            <input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              placeholder={t("categories.namePlaceholder")}
              className="min-w-0 flex-1 rounded-[9px] border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-brand"
            />
            <button
              type="button"
              disabled={busy}
              className="shrink-0 rounded-[9px] bg-book px-5 py-2 text-[13px] font-medium text-cream disabled:opacity-50"
              onClick={() => void doSaveName()}
            >
              {t("common.save")}
            </button>
          </div>
        }
      >
        <div className="py-2 text-sm text-ink-3">
          {t("categories.namePlaceholder")}
        </div>
      </Sheet>

      {/* 重命名 */}
      <Sheet
        open={sheet === "rename"}
        onOpenChange={(v) => !v && closeSheet()}
        title={t("categories.rename")}
        footer={
          <div className="flex gap-3">
            <input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              placeholder={t("categories.namePlaceholder")}
              className="min-w-0 flex-1 rounded-[9px] border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-brand"
            />
            <button
              type="button"
              disabled={busy}
              className="shrink-0 rounded-[9px] bg-book px-5 py-2 text-[13px] font-medium text-cream disabled:opacity-50"
              onClick={() => void doSaveName()}
            >
              {t("common.save")}
            </button>
          </div>
        }
      >
        <div className="py-2 text-sm text-ink-3">{t("categories.rename")}</div>
      </Sheet>

      {/* 换图标（编辑已有分类 / 新增分类时选择） */}
      <Sheet
        open={sheet === "icon"}
        onOpenChange={(v) => {
          if (!v) {
            if (iconForNew) setSheet("add");
            else closeSheet();
          }
        }}
        title={t("categories.changeIcon")}
      >
        {(target || iconForNew) && (
          <>
            <EmojiPicker
              onPick={async (emoji) => {
                if (iconForNew) {
                  setNewIcon({ icon: emoji, image: null });
                  setSheet("add");
                  return;
                }
                if (target) {
                  await runUpdate(
                    async () => {
                      await updateCategory(target.id, {
                        icon: emoji,
                        icon_image: null,
                        icon_type: "emoji",
                      });
                      closeSheet();
                    },
                    { change: "icon", icon_type: "emoji", icon: emoji },
                  );
                }
              }}
            />
            <button
              type="button"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-[10px] border border-line py-2.5 text-[13px] text-ink-2 transition-colors hover:bg-chip"
              onClick={() => fileRef.current?.click()}
            >
              <ImageIcon size={16} strokeWidth={1.8} />
              {t("categories.pickFromGallery")}
            </button>
            {target && !iconForNew && target.name_key && (
              <button
                type="button"
                className="mt-2 w-full rounded-[10px] border border-line py-2.5 text-[13px] text-ink-2 transition-colors hover:bg-chip"
                onClick={() => {
                  void runUpdate(
                    async () => {
                      await updateCategory(target.id, { icon_type: "auto" });
                      closeSheet();
                    },
                    { change: "icon", icon_type: "auto" },
                  );
                }}
              >
                {t("categories.resetIcon")}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onPickFile(e.target.files?.[0])}
            />
          </>
        )}
      </Sheet>

      {/* 更多操作 */}
      <Sheet
        open={sheet === "more"}
        onOpenChange={(v) => !v && closeSheet()}
        title={target ? displayName(target) : t("categories.more")}
      >
        {target && (
          <div className="flex flex-col gap-1 py-1">
            <SheetRow
              icon={<span className="text-base leading-none">＋</span>}
              label={t("categories.addChild")}
              onClick={() => openSheet(target, "add")}
            />
            <SheetRow
              icon={<Pencil size={16} className="text-ink-3" />}
              label={t("categories.rename")}
              onClick={() => openSheet(target, "rename")}
            />
            <SheetRow
              icon={<Palette size={16} className="text-ink-3" />}
              label={t("categories.changeIcon")}
              onClick={() => openSheet(target, "icon")}
            />
            {target.is_system === 1 ? (
              <SheetRow
                icon={
                  target.hidden ? (
                    <Eye size={16} className="text-ink-3" />
                  ) : (
                    <EyeOff size={16} className="text-ink-3" />
                  )
                }
                label={
                  target.hidden
                    ? t("categories.unhide")
                    : t("categories.hide")
                }
                onClick={() => {
                  void runUpdate(
                    async () => {
                      await updateCategory(target.id, {
                        hidden: target.hidden ? 0 : 1,
                      });
                      closeSheet();
                    },
                    { change: "hidden", hidden: target.hidden ? 0 : 1 },
                  );
                }}
              />
            ) : (
              <SheetRow
                icon={<Trash2 size={16} />}
                label={t("common.delete")}
                danger
                onClick={() => setConfirmDelete(true)}
              />
            )}
          </div>
        )}
      </Sheet>

      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("common.confirmDeleteTitle")}
        content={target ? displayName(target) : undefined}
        danger
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}

function SheetRow({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-2 rounded-[8px] px-2 py-3 text-left text-[14px] transition-colors hover:bg-chip active:bg-chip",
        danger ? "text-danger" : "text-ink",
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
