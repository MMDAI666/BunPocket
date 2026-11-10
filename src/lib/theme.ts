import { getSetting } from "../settings";

export type ThemeSetting = "auto" | "light" | "dark";

/** localStorage 镜像：供 index.html 内联脚本在 React 挂载前预先上色，规避深色模式冷启动白闪 */
const MIRROR_KEY = "bp:theme-setting";

let current: ThemeSetting = "auto";
let mediaListenerAttached = false;

function normalize(value: string | null): ThemeSetting {
  return value === "light" || value === "dark" || value === "auto"
    ? value
    : "auto";
}

export function resolveTheme(setting: ThemeSetting): "light" | "dark" {
  if (setting === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return setting;
}

function applyClass(setting: ThemeSetting): void {
  document.documentElement.classList.toggle(
    "dark",
    resolveTheme(setting) === "dark",
  );
}

/** 应用主题并更新镜像；`current` 决定"跟随系统"监听是否生效 */
export function applyThemeSetting(setting: ThemeSetting): void {
  current = setting;
  applyClass(setting);
  try {
    localStorage.setItem(MIRROR_KEY, setting);
  } catch {
    /* 隐私模式/存储不可用时忽略，仅影响下一次冷启动的预上色 */
  }
}

/**
 * 应用启动时调用一次（main.tsx）：
 * 1. 先按 localStorage 镜像同步上色（内联脚本之外的兜底，避免闪白）；
 * 2. 再从 SQLite 读取真实设置并应用；
 * 3. 全局只挂一个 prefers-color-scheme 监听，"跟随系统"在所有页面都生效。
 */
export function initTheme(): void {
  try {
    const mirror = localStorage.getItem(MIRROR_KEY);
    if (mirror) applyThemeSetting(normalize(mirror));
    else applyClass("auto");
  } catch {
    applyClass("auto");
  }

  void getSetting("theme")
    .then((value) => applyThemeSetting(normalize(value)))
    .catch(() => {
      /* DB 不可用时保持镜像/系统默认 */
    });

  if (!mediaListenerAttached) {
    mediaListenerAttached = true;
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (event) => {
        if (current === "auto") {
          document.documentElement.classList.toggle("dark", event.matches);
        }
      });
  }
}
