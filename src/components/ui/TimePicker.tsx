import { useTranslation } from "react-i18next";
import { Wheel } from "./Wheel";

interface TimePickerProps {
  value: string; // HH:MM
  onChange: (time: string) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 时/分双滚轮时间选择（配合 Sheet 使用） */
export function TimePicker({ value, onChange }: TimePickerProps) {
  const { t } = useTranslation();
  const [h, m] = value.split(":").map(Number);
  const hour = Number.isFinite(h) ? Math.min(Math.max(h, 0), 23) : 0;
  const minute = Number.isFinite(m) ? Math.min(Math.max(m, 0), 59) : 0;

  return (
    <div className="flex items-center">
      <div className="flex-1">
        <Wheel
          items={HOURS}
          value={hour}
          onChange={(v) => onChange(`${pad2(v)}:${pad2(minute)}`)}
          render={(v) => pad2(v)}
          ariaLabel={t("add.pickTime")}
        />
      </div>
      <div className="px-1 text-xl font-semibold text-ink-3">:</div>
      <div className="flex-1">
        <Wheel
          items={MINUTES}
          value={minute}
          onChange={(v) => onChange(`${pad2(hour)}:${pad2(v)}`)}
          render={(v) => pad2(v)}
          ariaLabel={t("add.pickTime")}
        />
      </div>
    </div>
  );
}
