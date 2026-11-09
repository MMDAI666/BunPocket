import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";

export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type LocaleSetting = "auto" | Locale;

export function resolveLocale(setting: LocaleSetting): Locale {
  if (setting !== "auto") return setting;
  const nav = navigator.language?.toLowerCase() ?? "zh";
  return nav.startsWith("zh") ? "zh-CN" : "en-US";
}

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
  },
  lng: resolveLocale("auto"),
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

export default i18n;
