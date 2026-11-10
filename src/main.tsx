import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastHost } from "./components/ui/Toast";
import { applyPendingRestore, ensureDailyBackup } from "./lib/backup";
import { initTheme } from "./lib/theme";
import "./i18n";
import "./index.css";

/**
 * 启动顺序很重要：
 * 1. 先应用上次准备的两阶段恢复（旧 schema 备份必须在新进程里换库并跑迁移）；
 * 2. 再初始化主题（会读 settings → 打开数据库）；
 * 3. 最后挂载 React 并触发每日备份。
 */
async function bootstrap() {
  try {
    await applyPendingRestore();
  } catch (e) {
    console.error("apply pending restore failed:", e);
  }
  // 主题必须在首屏渲染前初始化（否则深色设置要等进入设置页才生效）
  initTheme();
  // 每天首次启动自动备份（内部当天去重，失败静默不影响使用）
  void ensureDailyBackup();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
        <ToastHost />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void bootstrap();
