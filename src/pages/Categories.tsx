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
  updateCategory,
} from "../db";
import { buildCategoryTree } from "../lib/category";
import { fileToIconDataUrl } from "../lib/image";
import { cn } from "../lib/cn";
import { Image as ImageIcon } from "lucide-react";
import { toast } from "../components/ui/Toast";
import { Segmented } from "../components/ui/Segmented";
import { Sheet } from "../components/ui/Sheet";
import { Confirm } from "../components/ui/Confirm";
import { IconBadge } from "../components/ui/IconBadge";
import { EmojiPicker } from "../components/ui/EmojiPicker";

type SheetAction = "add" | "rename" | "icon" | "more" | null;

export function Categories() {
  const { t } = useTranslation();
  const goBack = useAppBack();
  const [kind, setKind] = useState<BillKind>("expense");
  const [roots, setRoots] = useState<Category[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<Category | null>(null);
  const [sheet, setSheet] = useState<SheetAction>(null);
  const [nameValue, setNameValue] = useState("");
  const [newIcon, setNewIcon] = useState<{ icon: string; image: string | null }>({
    icon: "🏷️",
    image: null,
  });
  const [iconForNew, setIconForNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    try {
      setRoots(buildCategoryTree(await loadCategoryRows()));
    } catch {
      setRoots([]);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const displayName = (cat: Category) =>
    cat.name_key ? t(cat.name_key) : cat.name;

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
    const name = nameValue.trim();
    if (!name) return;
    if (sheet === "add") {
      if (target) {
        await insertCategory({
          parent_id: target.id,
          name,
          icon: newIcon.icon,
          icon_image: newIcon.image,
          icon_type: newIcon.image ? "image" : "emoji",
          kind: target.kind,
        });
        setExpanded((prev) => new Set(prev).add(target.id));
      } else {
        await insertCategory({
          parent_id: null,
          name,
          icon: newIcon.icon,
          icon_image: newIcon.image,
          icon_type: newIcon.image ? "image" : "emoji",
          kind,
        });
      }
    } else if (sheet === "rename" && target) {
      await updateCategory(target.id, { name, name_key: null });
    }
    closeSheet();
    await reload();
  };

  const doDelete = async () => {
    if (!target) return;
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
    closeSheet();
    await reload();
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
        await updateCategory(target.id, { icon_image: dataUrl, icon_type: "image" });
        closeSheet();
        await reload();
      }
    } catch {
      toast.show(t("common.saveFailed"), "error");
    }
  };

  const renderRow = (cat: Category, depth: number): ReactNode => (
    <div key={cat.id}>
      <div
        className={cn("flex items-center px-3 py-2 active:bg-chip", cat.hidden === 1 && "opacity-45")}
        style={{ paddingLeft: 12 + depth * 20 }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center text-left"
          onClick={() => cat.children.length > 0 && toggleExpand(cat.id)}
        >
          <IconBadge icon={cat.icon} iconImage={cat.icon_image} nameKey={cat.name_key} iconType={cat.icon_type} />
          <span className="ml-2 min-w-0 flex-1 truncate text-[15px] text-ink">
            {displayName(cat)}
          </span>
          {cat.is_system === 1 && depth === 0 && (
            <span className="ml-1 rounded bg-chip px-1.5 py-0.5 text-[10px] text-ink-3">
              {t("categories.systemCategory")}
            </span>
          )}
          {cat.children.length > 0 && (
            <span className="ml-1 text-xs text-ink-3">
              {expanded.has(cat.id) ? "▾" : "▸"} {cat.children.length}
            </span>
          )}
        </button>
        <button
          type="button"
          className="ml-1 rounded-full px-2 py-1 text-sm text-ink-3 active:bg-chip"
          onClick={() => openSheet(cat, "add")}
          aria-label={t("categories.addChild")}
        >
          ＋
        </button>
        <button
          type="button"
          className="rounded-full px-2 py-1 text-sm text-ink-3 active:bg-chip"
          onClick={() => openSheet(cat, "more")}
          aria-label={t("common.edit")}
        >
          ⋯
        </button>
      </div>
      {expanded.has(cat.id) && cat.children.map((child) => renderRow(child, depth + 1))}
    </div>
  );

  const visibleRoots = (roots ?? []).filter((c) => c.kind === kind);

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
          {t("categories.title")}
        </div>
        <div className="w-10" />
      </div>

      <div className="px-4 pb-2">
        <Segmented
          options={[
            { value: "expense", label: t("add.expense") },
            { value: "income", label: t("add.income") },
          ]}
          value={kind}
          onChange={setKind}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        <div className="mx-3 rounded-2xl bg-card">
          {roots === null ? (
            <div className="py-10 text-center text-sm text-ink-3">…</div>
          ) : visibleRoots.length === 0 ? (
            <div className="py-10 text-center text-sm text-ink-3">
              {t("common.empty")}
            </div>
          ) : (
            visibleRoots.map((cat) => renderRow(cat, 0))
          )}
        </div>

        <div className="mx-3 mt-3">
          <button
            type="button"
            className="w-full rounded-2xl border border-dashed border-line bg-card py-3 text-sm text-ink-2 active:bg-chip"
            onClick={() => openSheet(null, "add")}
          >
            ＋ {t("categories.addTopLevel")}
          </button>
        </div>
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
              className="min-w-0 flex-1 rounded-full border border-line bg-card px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand"
            />
            <button
              type="button"
              className="shrink-0 rounded-full bg-gradient-to-r from-brand-1 to-brand-2 px-5 text-sm font-medium text-white"
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
              className="min-w-0 flex-1 rounded-full border border-line bg-card px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand"
            />
            <button
              type="button"
              className="rounded-full bg-gradient-to-r from-brand-1 to-brand-2 px-5 text-sm font-medium text-white"
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
                  await updateCategory(target.id, { icon: emoji, icon_image: null, icon_type: "emoji" });
                  closeSheet();
                  await reload();
                }
              }}
            />
            <button
              type="button"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm text-ink-2 active:bg-chip"
              onClick={() => fileRef.current?.click()}
            >
              <ImageIcon size={16} />
              {t("categories.pickFromGallery")}
            </button>
            {target && !iconForNew && target.name_key && (
              <button
                type="button"
                className="mt-2 w-full rounded-xl border border-line py-2.5 text-sm text-ink-2 active:bg-chip"
                onClick={async () => {
                  await updateCategory(target.id, { icon_type: "auto" });
                  closeSheet();
                  await reload();
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
      <Sheet open={sheet === "more"} onOpenChange={(v) => !v && closeSheet()}>
        {target && (
          <div className="flex flex-col gap-1 py-1">
            <SheetRow
              label={`✏️ ${t("categories.rename")}`}
              onClick={() => openSheet(target, "rename")}
            />
            <SheetRow
              label={`🎨 ${t("categories.changeIcon")}`}
              onClick={() => openSheet(target, "icon")}
            />
            {target.is_system === 1 ? (
              <SheetRow
                label={
                  target.hidden
                    ? `👁 ${t("categories.unhide")}`
                    : `🙈 ${t("categories.hide")}`
                }
                onClick={async () => {
                  await updateCategory(target.id, { hidden: target.hidden ? 0 : 1 });
                  closeSheet();
                  await reload();
                }}
              />
            ) : (
              <SheetRow
                label={`🗑 ${t("common.delete")}`}
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
  label,
  onClick,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-lg px-2 py-3 text-left text-[15px] active:bg-chip",
        danger ? "text-danger" : "text-ink",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
