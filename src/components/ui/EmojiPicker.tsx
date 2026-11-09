import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EMOJI_GROUPS } from "../../lib/emoji";
import { cn } from "../../lib/cn";

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
}

/** emoji 图标网格选择器（配合 Sheet 使用），分主题 tab */
export function EmojiPicker({ onPick }: EmojiPickerProps) {
  const { t } = useTranslation();
  const [group, setGroup] = useState(EMOJI_GROUPS[0].key);
  const current =
    EMOJI_GROUPS.find((g) => g.key === group) ?? EMOJI_GROUPS[0];

  return (
    <div>
      <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1">
        {EMOJI_GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs whitespace-nowrap",
              g.key === group
                ? "bg-chip font-medium text-ink"
                : "text-ink-3",
            )}
            onClick={() => setGroup(g.key)}
          >
            {t(`emoji.${g.key}`)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-y-1">
        {current.emojis.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            type="button"
            className="flex h-11 items-center justify-center text-2xl active:scale-90"
            onClick={() => onPick(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
