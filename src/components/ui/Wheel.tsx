import {
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";

interface WheelProps<T extends string | number> {
  items: readonly T[];
  value: T;
  onChange: (value: T) => void;
  render?: (item: T, selected: boolean) => ReactNode;
  itemHeight?: number;
  visibleCount?: number;
  ariaLabel?: string;
}

/**
 * 滚轮选择器：CSS scroll-snap 列，滚动停稳后按位置反推选中项，
 * 惯性/回弹物理全部由浏览器原生提供。
 */
export function Wheel<T extends string | number>({
  items,
  value,
  onChange,
  render,
  itemHeight = 40,
  visibleCount = 5,
  ariaLabel,
}: WheelProps<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const height = itemHeight * visibleCount;
  const pad = (height - itemHeight) / 2;
  const selectedIndex = Math.max(items.indexOf(value), 0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const idx = Math.min(
          Math.max(Math.round(el.scrollTop / itemHeight), 0),
          items.length - 1,
        );
        const next = items[idx];
        if (next !== value) onChange(next);
      }, 80);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [items, itemHeight, onChange, value]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const target = selectedIndex * itemHeight;
    if (Math.abs(el.scrollTop - target) >= 1) {
      el.scrollTo({ top: target, behavior: "auto" });
    }
  }, [selectedIndex, itemHeight]);

  return (
    <div className="relative" style={{ height }}>
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 border-y border-line"
        style={{ height: itemHeight }}
      />
      <div
        ref={scrollerRef}
        className="wheel-fade h-full overflow-y-auto"
        style={{ scrollSnapType: "y mandatory" }}
        role="listbox"
        aria-label={ariaLabel}
      >
        <div style={{ height: pad }} />
        {items.map((item, i) => (
          <div
            key={item}
            role="option"
            aria-selected={i === selectedIndex}
            className={cn(
              "flex items-center justify-center transition-colors",
              i === selectedIndex
                ? "text-base font-semibold text-ink"
                : "text-ink-3",
            )}
            style={{ height: itemHeight, scrollSnapAlign: "center" }}
          >
            {render ? render(item, i === selectedIndex) : item}
          </div>
        ))}
        <div style={{ height: pad }} />
      </div>
    </div>
  );
}
