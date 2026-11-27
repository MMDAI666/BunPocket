import { useMemo, useState, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Category } from "../db";
import { cn } from "../lib/cn";
import { IconBadge } from "./ui/IconBadge";

/**
 * 分类排序模式：长按拖动（触摸）/ 按住拖动（鼠标）。
 * 一级分类是「整块」——拖动时子分类行跟着它一起走；二级分类只在自己父级内换位。
 * 松手后由 onReorder 一次性落库（父级 + 完整顺序），失败由页面统一回滚。
 */

/** 行携带的拖动数据：只有同一 parentId 的行才允许互相换位 */
interface RowData {
  parentId: number | null;
}

interface DragState {
  cat: Category;
  depth: number;
}

interface TreeMeta {
  groups: Map<number | null, Category[]>;
  depths: Map<number, number>;
}

interface CategorySortTreeProps {
  /** 当前支出/收入下的一级分类（含隐藏分类） */
  roots: Category[];
  expanded: Set<number>;
  disabled?: boolean;
  onToggleExpand: (id: number) => void;
  onReorder: (parentId: number | null, orderedIds: number[]) => void;
}

export function CategorySortTree({
  roots,
  expanded,
  disabled = false,
  onToggleExpand,
  onReorder,
}: CategorySortTreeProps) {
  const { t } = useTranslation();
  const meta = useMemo(() => buildTreeMeta(roots), [roots]);
  const [dragging, setDragging] = useState<DragState | null>(null);

  // 触摸：长按 460ms 才进入拖动（低于阈值先让位给列表滚动）；鼠标：按住移动 6px 即拖，
  // 不移动的普通点击不会激活拖动，所以「点行展开/收起」仍然可用。
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 460, tolerance: 10 },
    }),
  );

  // 只在同父级的行之间找落点：拖一级时不会被自己的子行抢走 over，也不会跨组吸附
  const collisionDetection: CollisionDetection = (args) => {
    const parentId = readParentId(args.active);
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) => readParentId(container) === parentId,
      ),
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const parentId = readParentId(event.active);
    const id = Number(event.active.id);
    const cat = meta.groups.get(parentId)?.find((item) => item.id === id);
    if (!cat) return;
    setDragging({
      cat,
      depth: meta.depths.get(id) ?? 0,
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const parentId = readParentId(active);
    if (parentId !== readParentId(over)) return;
    const ids = (meta.groups.get(parentId) ?? []).map((item) => item.id);
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from < 0 || to < 0 || from === to) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(parentId, next);
  };

  const draggedLabel = dragging
    ? dragging.cat.name_key
      ? t(dragging.cat.name_key)
      : dragging.cat.name
    : "";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <SortableContext
        id="category-sort-root"
        items={roots.map((cat) => cat.id)}
        strategy={verticalListSortingStrategy}
      >
        {roots.map((cat) => (
          <SortableRow
            key={cat.id}
            cat={cat}
            depth={0}
            parentId={null}
            expanded={expanded}
            disabled={disabled}
            onToggleExpand={onToggleExpand}
          />
        ))}
      </SortableContext>

      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div
            className="paper flex items-center px-3 py-2.5 shadow-[0_12px_28px_-14px_rgba(29,42,38,0.45)]"
            style={{ paddingLeft: 12 + Math.min(dragging.depth, 4) * 18 }}
          >
            <RowBody
              cat={dragging.cat}
              depth={dragging.depth}
              label={draggedLabel}
              open={expanded.has(dragging.cat.id)}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

interface SortableRowProps {
  cat: Category;
  depth: number;
  parentId: number | null;
  expanded: Set<number>;
  disabled: boolean;
  onToggleExpand: (id: number) => void;
}

function SortableRow({
  cat,
  depth,
  parentId,
  expanded,
  disabled,
  onToggleExpand,
}: SortableRowProps) {
  const { t } = useTranslation();
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: cat.id,
      data: { parentId } satisfies RowData,
      disabled,
    });
  const hasChildren = cat.children.length > 0;
  const open = expanded.has(cat.id);
  const label = cat.name_key ? t(cat.name_key) : cat.name;
  const style: CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition: transition ?? undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "relative z-10 opacity-30")}
    >
      <div
        {...listeners}
        role={hasChildren ? "button" : undefined}
        tabIndex={hasChildren ? 0 : undefined}
        aria-expanded={hasChildren ? open : undefined}
        onClick={hasChildren ? () => onToggleExpand(cat.id) : undefined}
        onKeyDown={
          hasChildren
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggleExpand(cat.id);
                }
              }
            : undefined
        }
        className={cn(
          "flex touch-manipulation select-none items-center px-3 py-2.5 transition-colors",
          "active:bg-chip/40",
          hasChildren && "cursor-pointer",
          cat.hidden === 1 && "opacity-45",
        )}
        style={{ paddingLeft: 12 + Math.min(depth, 4) * 18 }}
      >
        <RowBody
          cat={cat}
          depth={depth}
          label={label}
          open={open}
          systemLabel={t("categories.systemCategory")}
        />
      </div>

      {hasChildren && open && (
        <SortableContext
          id={`category-sort-group-${cat.id}`}
          items={cat.children.map((child) => child.id)}
          strategy={verticalListSortingStrategy}
        >
          {cat.children.map((child) => (
            <SortableRow
              key={child.id}
              cat={child}
              depth={depth + 1}
              parentId={cat.id}
              expanded={expanded}
              disabled={disabled}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </SortableContext>
      )}
    </div>
  );
}

interface RowBodyProps {
  cat: Category;
  depth: number;
  label: string;
  open: boolean;
  /** 传了才渲染「预置」角标（拖动浮层里不显示，避免花） */
  systemLabel?: string;
}

function RowBody({ cat, depth, label, open, systemLabel }: RowBodyProps) {
  const hasChildren = cat.children.length > 0;
  return (
    <>
      <IconBadge
        icon={cat.icon}
        iconImage={cat.icon_image}
        nameKey={cat.name_key}
        iconType={cat.icon_type}
      />
      <span className="ml-2 min-w-0 flex-1 truncate text-[14px] text-ink">
        {label}
      </span>
      {systemLabel && cat.is_system === 1 && depth === 0 && (
        <span className="ml-1.5 shrink-0 rounded-[4px] border border-line px-1.5 py-0.5 text-[9px] text-ink-3">
          {systemLabel}
        </span>
      )}
      {hasChildren && (
        <span className="ml-1 flex items-center gap-0.5 text-[10px] text-ink-3">
          {open ? (
            <ChevronDown size={12} strokeWidth={1.9} />
          ) : (
            <ChevronRight size={12} strokeWidth={1.9} />
          )}
          {cat.children.length}
        </span>
      )}
    </>
  );
}

function buildTreeMeta(roots: Category[]): TreeMeta {
  const groups = new Map<number | null, Category[]>();
  const depths = new Map<number, number>();
  groups.set(null, roots);
  const walk = (nodes: Category[], depth: number) => {
    for (const node of nodes) {
      depths.set(node.id, depth);
      if (node.children.length > 0) {
        groups.set(node.id, node.children);
        walk(node.children, depth + 1);
      }
    }
  };
  walk(roots, 0);
  return { groups, depths };
}

/** 从拖动数据里读分组 id；一级分类为 null */
function readParentId(node: {
  data: { current?: Record<string, unknown> | null };
}): number | null {
  const value = node.data.current?.parentId;
  return typeof value === "number" ? value : null;
}
