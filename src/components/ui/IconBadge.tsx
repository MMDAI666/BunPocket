import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { categoryIcon } from "../../lib/categoryIcon";
import type { IconType } from "../../db";

interface IconBadgeProps {
  icon?: string;
  iconImage?: string | null;
  /** 系统分类的 i18n key，用于匹配图标库 */
  nameKey?: string | null;
  /** 图标类型：auto=默认彩色 emoji；emoji/image 为用户显式选择；icon 为空时回退图标库 SVG */
  iconType?: IconType | null;
  size?: "sm" | "md" | "lg";
  /** 覆盖 SVG 图标像素尺寸（用于被 className 缩小的特殊场景） */
  iconSize?: number;
  className?: string;
}

/** 分类图标统一渲染：自定义图片 / emoji / 图标库 SVG（按 icon_type 决定优先级），浅灰圆底 */
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
      ? "h-9 w-9 text-lg"
      : size === "lg"
        ? "h-14 w-14 text-3xl"
        : "h-11 w-11 text-2xl";
  const px = iconSize ?? (size === "sm" ? 18 : size === "lg" ? 30 : 24);

  const LibIcon =
    iconType === "emoji" || iconType === "image"
      ? null
      : categoryIcon(nameKey);

  let content: ReactNode;
  if (iconType === "image" && iconImage) {
    content = <img src={iconImage} alt="" className="h-full w-full object-cover" draggable={false} />;
  } else if (iconType === "emoji" && icon) {
    content = <span>{icon}</span>;
  } else if (icon) {
    // auto：默认显示彩色 emoji（系统/自定义分类库里的 icon 字段）
    content = <span>{icon}</span>;
  } else if (iconImage) {
    content = <img src={iconImage} alt="" className="h-full w-full object-cover" draggable={false} />;
  } else if (LibIcon) {
    content = <LibIcon size={px} strokeWidth={1.8} className="text-ink-2" />;
  } else {
    content = <span>{icon}</span>;
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-chip",
        dims,
        className,
      )}
    >
      {content}
    </div>
  );
}
