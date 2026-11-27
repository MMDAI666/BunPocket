import { cn } from "../../lib/cn";

interface BudgetRulerProps {
  /** 已用（分） */
  spent: number;
  /** 预算（分），<= 0 时不绘制 */
  total: number;
  /** 周期时间位置 0~1（含今天），用于标尺上的「今天」刻度 */
  dayProgress?: number | null;
  /** 书封上的浅色版 */
  onBook?: boolean;
  className?: string;
  label?: string;
}

/**
 * 预算节奏标尺：一条线上同时给出「钱花了多少」和「周期走到哪」。
 * 刻度是标尺的本体，不做纯装饰：10 格对应周期的十分位。
 */
export function BudgetRuler({
  spent,
  total,
  dayProgress,
  onBook = false,
  className,
  label,
}: BudgetRulerProps) {
  const safeTotal = Math.max(total, 0);
  const ratio = safeTotal > 0 ? spent / safeTotal : 0;
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const over = safeTotal > 0 && spent > safeTotal;
  const day =
    dayProgress == null
      ? null
      : Math.min(Math.max(dayProgress, 0), 1);

  const fill = over ? "bg-expense" : "bg-brand";
  const track = onBook ? "bg-cover-line" : "bg-chip";
  const tick = onBook ? "bg-cover-line" : "bg-line";
  const notch = onBook ? "bg-cover-ink" : "bg-ink";

  return (
    <div
      className={cn("relative h-4", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
    >
      <div className="absolute inset-x-0 top-1 flex h-1.5 items-end justify-between">
        {Array.from({ length: 11 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "w-px",
              tick,
              i % 5 === 0 ? "h-1.5" : "h-1",
            )}
          />
        ))}
      </div>
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 h-[6px] overflow-hidden rounded-full",
          track,
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            fill,
          )}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
      {day != null && (
        <span
          className={cn(
            "absolute -top-0.5 h-[17px] w-[2px] -translate-x-1/2 rounded-full",
            notch,
          )}
          style={{ left: `${day * 100}%` }}
        />
      )}
    </div>
  );
}
