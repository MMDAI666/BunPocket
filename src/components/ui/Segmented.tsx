import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "md" | "sm";
  block?: boolean;
}

/** 分段选择：浅紫底 + 实心书封块，不再使用渐变胶囊 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  block = true,
}: SegmentedProps<T>) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[11px] bg-chip p-[3px]",
        block && "flex w-full",
      )}
      role="tablist"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={cn(
            "flex-1 rounded-[8px] text-center whitespace-nowrap transition-colors",
            size === "sm" ? "px-2 py-1 text-[11px]" : "px-4 py-1.5 text-[13px]",
            value === opt.value
              ? "bg-brand-soft font-medium text-brand"
              : "text-ink-2 hover:text-ink",
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
