import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { useLongPress } from "../../hooks/useLongPress";

interface NoteTagProps {
  note: string;
  /** 单击：把备注填入输入框 */
  onPick: (note: string) => void;
  /** 长按粉碎后：从候选里移除（由父组件持久化） */
  onShatter: (note: string) => void;
}

/** 碎片形状 / 飞散方向；百分比贴着标签本身，px 是散开距离 */
const SHARDS: {
  left: string;
  top: string;
  width: string;
  height: string;
  dx: string;
  dy: string;
  rot: string;
}[] = [
  { left: "4%", top: "6%", width: "27%", height: "34%", dx: "-20px", dy: "-26px", rot: "-48deg" },
  { left: "33%", top: "4%", width: "24%", height: "30%", dx: "8px", dy: "-30px", rot: "34deg" },
  { left: "62%", top: "8%", width: "30%", height: "36%", dx: "26px", dy: "-20px", rot: "56deg" },
  { left: "8%", top: "52%", width: "26%", height: "34%", dx: "-26px", dy: "22px", rot: "42deg" },
  { left: "38%", top: "56%", width: "22%", height: "30%", dx: "2px", dy: "28px", rot: "-24deg" },
  { left: "66%", top: "50%", width: "24%", height: "32%", dx: "24px", dy: "24px", rot: "38deg" },
];

/** 备注历史标签：单击填入，长按/Delete 键粉碎后从候选里删除 */
export function NoteTag({ note, onPick, onShatter }: NoteTagProps) {
  const { t } = useTranslation();
  const [breaking, setBreaking] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  const shatter = useCallback(() => {
    if (breaking) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      onShatter(note);
      return;
    }
    setBreaking(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onShatter(note);
    }, 360);
  }, [breaking, note, onShatter]);

  const { longPressProps } = useLongPress({ onLongPress: shatter });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Delete") {
      event.preventDefault();
      shatter();
    }
  };

  return (
    <span className={cn("note-tag", breaking && "note-tag--breaking")}>
      <button
        type="button"
        {...longPressProps}
        onClick={() => {
          if (!breaking) onPick(note);
        }}
        onKeyDown={onKeyDown}
        title={t("add.noteLongPress")}
        className={cn(
          "note-tag__chip max-w-full truncate rounded-[8px] bg-chip px-2 py-1 text-[11px] text-ink-2 transition-colors",
          !breaking && "hover:bg-line active:bg-line",
        )}
      >
        <span className="note-tag__label">{note}</span>
      </button>
      {breaking && (
        <span className="note-tag__shards" aria-hidden="true">
          {SHARDS.map((shard, index) => (
            <span
              key={index}
              className="note-tag__shard"
              style={
                {
                  left: shard.left,
                  top: shard.top,
                  width: shard.width,
                  height: shard.height,
                  "--dx": shard.dx,
                  "--dy": shard.dy,
                  "--rot": shard.rot,
                } as CSSProperties
              }
            />
          ))}
        </span>
      )}
    </span>
  );
}
