import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { yearMonthLabel } from "../../lib/format";
import { cn } from "../../lib/cn";

interface MonthCalendarProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  locale: string;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 月历选择器：7 列网格，支持左右滑动切月、点标题跳转指定年月日 */
export function MonthCalendar({ value, onChange, locale }: MonthCalendarProps) {
  const { t } = useTranslation();
  const [view, setView] = useState(() => {
    const [y, m] = value.split("-").map(Number);
    return { year: y, month: m - 1 };
  });
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpY, setJumpY] = useState(String(view.year));
  const [jumpM, setJumpM] = useState(String(view.month + 1));
  const [jumpD, setJumpD] = useState("1");
  const [dir, setDir] = useState<"next" | "prev">("next");
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const weekStartsMonday = locale.startsWith("zh");
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

  const firstDay = new Date(view.year, view.month, 1).getDay(); // 0=周日
  const leading = weekStartsMonday ? (firstDay + 6) % 7 : firstDay;
  const total = daysInMonth(view.year, view.month);

  const weekdayLabels = weekStartsMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "narrow" });

  const shiftMonth = (delta: number) => {
    setDir(delta > 0 ? "next" : "prev");
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const applyJump = () => {
    const y = Number(jumpY);
    const m = Number(jumpM);
    const d = Number(jumpD);
    if (
      !Number.isInteger(y) || y < 1900 || y > 2100 ||
      !Number.isInteger(m) || m < 1 || m > 12 ||
      !Number.isInteger(d) || d < 1 || d > daysInMonth(y, m - 1)
    ) {
      return;
    }
    setView({ year: y, month: m - 1 });
    onChange(`${y}-${pad2(m)}-${pad2(d)}`);
    setJumpOpen(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 active:bg-chip"
          onClick={() => shiftMonth(-1)}
          aria-label={t("common.prevMonth")}
        >
          ‹
        </button>
        <button
          type="button"
          className="rounded-full px-3 py-1 text-base font-semibold text-ink active:bg-chip"
          onClick={() => {
            setJumpY(String(view.year));
            setJumpM(String(view.month + 1));
            setJumpD("1");
            setJumpOpen((v) => !v);
          }}
        >
          {yearMonthLabel(view.year, view.month + 1, locale)}
        </button>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 active:bg-chip"
          onClick={() => shiftMonth(1)}
          aria-label={t("common.nextMonth")}
        >
          ›
        </button>
      </div>

      {jumpOpen && (
        <div className="flex items-center gap-2 pb-2">
          <JumpInput value={jumpY} onChange={setJumpY} placeholder="YYYY" />
          <span className="text-ink-3">-</span>
          <JumpInput value={jumpM} onChange={setJumpM} placeholder="MM" />
          <span className="text-ink-3">-</span>
          <JumpInput value={jumpD} onChange={setJumpD} placeholder="DD" />
          <button
            type="button"
            className="ml-1 shrink-0 rounded-full bg-gradient-to-r from-brand-1 to-brand-2 px-4 py-1.5 text-xs font-medium text-white"
            onClick={applyJump}
          >
            {t("common.ok")}
          </button>
        </div>
      )}

      <div
        onTouchStart={(e) => {
          const touch = e.touches[0];
          touchStart.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          if (!start) return;
          const touch = e.changedTouches[0];
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          touchStart.current = null;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            shiftMonth(dx < 0 ? 1 : -1);
          }
        }}
      >
        <div className="grid grid-cols-7">
          {weekdayLabels.map((wd, i) => (
            <div key={i} className="py-1 text-center text-xs text-ink-3">
              {weekdayFmt.format(new Date(2024, 0, 7 + wd))}
            </div>
          ))}
        </div>
        <div
          key={`${view.year}-${view.month}`}
          className={`grid grid-cols-7 ${dir === "next" ? "cal-next" : "cal-prev"}`}
        >
          {Array.from({ length: leading }, (_, i) => (
            <div key={`blank-${i}`} />
          ))}
        {Array.from({ length: total }, (_, i) => {
          const day = i + 1;
          const dateStr = `${view.year}-${pad2(view.month + 1)}-${pad2(day)}`;
          const selected = dateStr === value;
          const isToday = dateStr === todayStr;
          return (
            <button
              key={day}
              type="button"
              className={cn(
                "mx-auto my-0.5 flex h-10 w-10 items-center justify-center rounded-full text-[15px]",
                selected
                  ? "bg-gradient-to-r from-brand-1 to-brand-2 font-semibold text-white"
                  : isToday
                    ? "font-semibold text-brand"
                    : "text-ink",
              )}
              onClick={() => onChange(dateStr)}
            >
              {day}
            </button>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function JumpInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      inputMode="numeric"
      placeholder={placeholder}
      className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-center text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand"
    />
  );
}
