import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastHost } from "./components/ui/Toast";
import { ensureDailyBackup } from "./lib/backup";
import "./i18n";
import "./index.css";

// 每天首次启动自动备份（内部当天去重，失败静默不影响使用）
void ensureDailyBackup();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <ToastHost />
  </React.StrictMode>,
);
