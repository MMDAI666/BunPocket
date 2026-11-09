import { useTranslation } from "react-i18next";
import { pressKey, type PadKey } from "../../lib/money";
import { cn } from "../../lib/cn";

interface NumberPadProps {
  /** 表达式字符串，如 "12.5+3" */
  value: string;
  onChange: (expr: string) => void;
  onSubmit: () => void;
  submitDisabled?: boolean;
  /** 「再记」：保存当前笔并继续 */
  onAnother?: () => void;
}

const DIGIT_KEYS: (PadKey | "again" | "ok")[][] = [
  ["1", "2", "3", "-"],
  ["4", "5", "6", "+"],
  ["7", "8", "9", "again"],
  [".", "0", "back", "ok"],
];

/** 记一笔数字键盘：4×4，支持 +/− 表达式、退格、再记与大号确定键 */
export function NumberPad({
  value,
  onChange,
  onSubmit,
  submitDisabled = false,
  onAnother,
}: NumberPadProps) {
  const { t } = useTranslation();

  const handle = (key: PadKey | "again" | "ok") => {    if (key === "ok") {
      if (!submitDisabled) onSubmit();
      return;
    }
    if (key === "again") {
      onAnother?.();
      return;
    }
    onChange(pressKey(value, key));
  };

  return (
    <div className="grid grid-cols-4 pb-[env(safe-area-inset-bottom)]">
      {DIGIT_KEYS.flat().map((key, i) => {
        if (key === "ok") {
          return (
            <button
              key={i}
              type="button"
              disabled={submitDisabled}
              className={cn(
                "h-14 bg-gradient-to-r from-brand-1 to-brand-2 text-lg font-semibold text-white",
                submitDisabled && "opacity-40",
              )}
              onClick={() => handle(key)}
            >
              {t("common.ok")}
            </button>
          );
        }
        if (key === "again") {
          return (
            <button
              key={i}
              type="button"
              className="h-14 bg-card text-sm text-ink-2 active:bg-chip"
              onClick={() => handle(key)}
            >
              {t("add.another")}
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            className="h-14 bg-card text-xl text-ink active:bg-chip"
            onClick={() => handle(key)}
          >
            {key === "back" ? "⌫" : key}
          </button>
        );
      })}
    </div>
  );
}
