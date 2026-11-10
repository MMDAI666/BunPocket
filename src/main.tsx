import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastHost } from "./components/ui/Toast";
import { ensureDailyBackup } from "./lib/backup";
import { initTheme } from "./lib/theme";
import "./i18n";
import "./index.css";

// 主题必须在首屏渲染前初始化（否则深色设置要等进入设置页才生效）
initTheme();

// 每天首次启动自动备份（内部当天去重，失败静默不影响使用）
void ensureDailyBackup();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <ToastHost />
  </React.StrictMode>,
);
