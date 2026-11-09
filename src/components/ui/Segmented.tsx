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
        "inline-flex items-center rounded-full border border-line bg-card p-0.5",
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
            "flex-1 rounded-full text-center whitespace-nowrap transition-colors",
            size === "sm" ? "px-2 py-1 text-xs" : "px-4 py-1.5 text-sm",
            value === opt.value
              ? "bg-gradient-to-r from-brand-1 to-brand-2 font-medium text-white"
              : "text-ink-2",
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
