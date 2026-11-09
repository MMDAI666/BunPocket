import { useCallback, useEffect, useState } from "react";
import i18n, { resolveLocale, type Locale, type LocaleSetting } from "../i18n";
import { getSetting, setSetting } from "../settings";

export function useLocale() {
  const [setting, setSettingState] = useState<LocaleSetting>("auto");

  useEffect(() => {
    let alive = true;
    getSetting("locale").then((v) => {
      if (!alive) return;
      const next: LocaleSetting =
        v === "zh-CN" || v === "en-US" || v === "auto" ? v : "auto";
      setSettingState(next);
      void i18n.changeLanguage(resolveLocale(next));
    });
  }, []);

  const update = useCallback(async (next: LocaleSetting) => {
    setSettingState(next);
    const locale: Locale = resolveLocale(next);
    await i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
    await setSetting("locale", next);
  }, []);

  return { setting, locale: i18n.language as Locale, update };
}
