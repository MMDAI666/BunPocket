import { useTranslation } from "react-i18next";
import { Delete } from "lucide-react";
import { pressKey, type PadKey } from "../../lib/money";
import { cn } from "../../lib/cn";

interface NumberPadProps {
  /** 表达式字符串，如 "12.5+3" */
  value: string;
  /** 按键后的新表达式；key 为实际按下的键，供调用方处理「＝」后的重开/续算 */
  onChange: (expr: string, key: PadKey) => void;
  onSubmit: () => void;
  submitDisabled?: boolean;
  /** 主键文案：算式可求值时传「＝」，默认「确定」 */
  submitLabel?: string;
  /** 「再记」：保存当前笔并继续 */
  onAnother?: () => void;
}

const DIGIT_KEYS: (PadKey | "again" | "ok")[][] = [
  ["1", "2", "3", "-"],
  ["4", "5", "6", "+"],
  ["7", "8", "9", "again"],
  [".", "0", "back", "ok"],
];

/** 记一笔数字键盘：4×4 细线格，支持 +/− 表达式、退格、再记与大号主键（文案可切「＝」） */
export function NumberPad({
  value,
  onChange,
  onSubmit,
  submitDisabled = false,
  submitLabel,
  onAnother,
}: NumberPadProps) {
  const { t } = useTranslation();

  const handle = (key: PadKey | "again" | "ok") => {
    if (key === "ok") {
      if (!submitDisabled) onSubmit();
      return;
    }
    if (key === "again") {
      onAnother?.();
      return;
    }
    onChange(pressKey(value, key), key);
  };

  return (
    <div className="grid shrink-0 grid-cols-4 gap-px border-t border-line bg-line pb-[env(safe-area-inset-bottom)]">
      {DIGIT_KEYS.flat().map((key, i) => {
        if (key === "ok") {
          return (
            <button
              key={i}
              type="button"
              disabled={submitDisabled}
              className={cn(
                "h-14 bg-book text-[15px] font-medium text-cream transition-opacity",
                submitDisabled && "opacity-40",
              )}
              onClick={() => handle(key)}
            >
              {submitLabel ?? t("common.ok")}
            </button>
          );
        }
        if (key === "again") {
          return (
            <button
              key={i}
              type="button"
              disabled={submitDisabled}
              className={cn(
                "h-14 bg-card text-[11px] text-ink-2 active:bg-chip",
                submitDisabled && "opacity-40",
              )}
              onClick={() => handle(key)}
            >
              {t("add.another")}
            </button>
          );
        }
        if (key === "back") {
          return (
            <button
              key={i}
              type="button"
              className="flex h-14 items-center justify-center bg-card text-ink-2 active:bg-chip"
              aria-label={t("common.backspace")}
              onClick={() => handle(key)}
            >
              <Delete size={21} strokeWidth={1.7} />
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            className={cn(
              "h-14 bg-card text-[22px] leading-none text-ink active:bg-chip",
              (key === "+" || key === "-") && "text-ink-2",
            )}
            onClick={() => handle(key)}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}
