import { useCallback, useEffect, useState } from "react";
import { getSetting, setSetting } from "../settings";
import { applyThemeSetting, type ThemeSetting } from "../lib/theme";

export type { ThemeSetting };

/** 设置页的主题选择 hook；主题生效与系统监听由 lib/theme.initTheme 全局负责 */
export function useTheme() {
  const [setting, setSettingState] = useState<ThemeSetting>("auto");

  useEffect(() => {
    let alive = true;
    getSetting("theme").then((value) => {
      if (!alive) return;
      const next: ThemeSetting =
        value === "light" || value === "dark" || value === "auto"
          ? value
          : "auto";
      setSettingState(next);
      applyThemeSetting(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback(async (next: ThemeSetting) => {
    setSettingState(next);
    applyThemeSetting(next);
    await setSetting("theme", next);
  }, []);

  return { setting, update };
}
