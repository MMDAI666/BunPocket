import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "../i18n";
import { errorMessage, logEvent } from "../lib/logger";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** 渲染崩溃兜底：避免整页白屏，至少给出重新加载入口 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void logEvent("error", "app.crash", {
      message: errorMessage(error),
      componentStack: (info.componentStack ?? "").slice(0, 800),
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-page px-8 text-center">
        <div className="text-base font-semibold text-ink">
          {i18n.t("common.appCrashed")}
        </div>
        <div className="max-w-64 text-sm text-ink-3">
          {i18n.t("common.appCrashedHint")}
        </div>
        <button
          type="button"
          className="rounded-[10px] bg-book px-5 py-2 text-sm font-medium text-cream"
          onClick={() => {
            // 先回首页再重载：避免确定性页面崩溃时 reload 回到同一路由反复崩溃
            window.location.hash = "#/";
            window.location.reload();
          }}
        >
          {i18n.t("common.backHome")}
        </button>
        <button
          type="button"
          className="text-xs text-ink-3 underline"
          onClick={() => window.location.reload()}
        >
          {i18n.t("common.reload")}
        </button>
      </div>
    );
  }
}
