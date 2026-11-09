import { useCallback, useEffect, useRef, useState } from "react";
import { getSetting, setSetting } from "../settings";

export type ThemeSetting = "auto" | "light" | "dark";

function resolveTheme(setting: ThemeSetting): "light" | "dark" {
  if (setting === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return setting;
}

function applyTheme(setting: ThemeSetting) {
  document.documentElement.classList.toggle(
    "dark",
    resolveTheme(setting) === "dark",
  );
}

export function useTheme() {
  const [setting, setSettingState] = useState<ThemeSetting>("auto");
  const settingRef = useRef(setting);
  settingRef.current = setting;

  useEffect(() => {
    let alive = true;
    getSetting("theme").then((v) => {
      if (!alive) return;
      const next = v === "light" || v === "dark" || v === "auto" ? v : "auto";
      setSettingState(next);
      applyTheme(next);
    });

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (settingRef.current === "auto") {
        document.documentElement.classList.toggle("dark", e.matches);
      }
    };
    media.addEventListener("change", onChange);
    return () => {
      alive = false;
      media.removeEventListener("change", onChange);
    };
  }, []);

  const update = useCallback(async (next: ThemeSetting) => {
    setSettingState(next);
    applyTheme(next);
    await setSetting("theme", next);
  }, []);

  return { setting, update };
}
