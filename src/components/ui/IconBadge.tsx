import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { categoryIcon } from "../../lib/categoryIcon";
import type { IconType } from "../../db";

interface IconBadgeProps {
  icon?: string;
  iconImage?: string | null;
  /** 系统分类的 i18n key，用于匹配图标库 */
  nameKey?: string | null;
  /**
   * 图标类型：
   * - auto：系统分类默认显示存储的 emoji；没有 emoji 才回退图标库 SVG
   * - emoji：用户显式选择 emoji，强制显示 icon 字段
   * - image：用户上传图片，显示 icon_image
   */
  iconType?: IconType | null;
  size?: "sm" | "md" | "lg";
  /** 覆盖 SVG 图标像素尺寸（用于被 className 缩小的特殊场景） */
  iconSize?: number;
  className?: string;
}

/** 分类图标统一渲染：自定义图片 / emoji / 图标库 SVG，浅紫纸片底 */
export function IconBadge({
  icon,
  iconImage,
  nameKey,
  iconType = "auto",
  size = "md",
  iconSize,
  className,
}: IconBadgeProps) {
  const dims =
    size === "sm"
      ? "h-9 w-9 rounded-[10px] text-lg"
      : size === "lg"
        ? "h-14 w-14 rounded-[16px] text-3xl"
        : "h-10 w-10 rounded-[11px] text-xl";
  const px = iconSize ?? (size === "sm" ? 18 : size === "lg" ? 28 : 22);

  // 图片/emoji 是用户显式选择，永远优先；auto 下 emoji 优先，没有 emoji 才回退图标库 SVG
  const LibIcon = categoryIcon(nameKey);

  let content: ReactNode;
  if (iconType === "image" && iconImage) {
    content = (
      <img
        src={iconImage}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
      />
    );
  } else if (iconType === "emoji" && icon) {
    content = <span>{icon}</span>;
  } else if (iconType === "auto" && icon) {
    content = <span>{icon}</span>;
  } else if (iconType === "auto" && LibIcon) {
    content = <LibIcon size={px} strokeWidth={1.8} className="text-ink-2" />;
  } else if (icon) {
    content = <span>{icon}</span>;
  } else if (iconImage) {
    content = (
      <img
        src={iconImage}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
      />
    );
  } else if (LibIcon) {
    content = <LibIcon size={px} strokeWidth={1.8} className="text-ink-2" />;
  } else {
    content = <span>{icon}</span>;
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden border border-line/70 bg-chip",
        dims,
        className,
      )}
    >
      {content}
    </div>
  );
}
