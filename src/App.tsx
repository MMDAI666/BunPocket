import { useEffect, useRef } from "react";
import {
  createHashRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useRouteError,
} from "react-router-dom";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { toast } from "./components/ui/Toast";
import i18n from "./i18n";
import { errorMessage, logEvent } from "./lib/logger";
import {
  supportsViewTransitions,
  useAppNavigate,
} from "./hooks/useAppNavigate";
import { Home } from "./pages/Home";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 深链导航：bunpocket://add → /add。冷启动靠 getCurrent、热启动靠 onOpenUrl，
 * 冷启动时两者先后报同一 URL，用时间窗去重；已在 /add 时用 replace 防叠栈。
 * 订阅必须只在挂载时注册一次——重新订阅会让插件重放缓存的深链 URL，
 * 造成"返回首页瞬间被拽回 /add"的弹回循环（曾用 CDP 实锤）。
 * 栈结构约定：组件进入也要保证 桌面→首页→记一笔，初始条目上先落首页再压记一笔。
 * 深链不是用户手势触发的页面切换，统一关闭 View Transition，避免冷启动双重过渡。 */
function useDeepLinkNavigate(
  navigate: ReturnType<typeof useAppNavigate>,
) {
  const location = useLocation();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;
  const keyRef = useRef(location.key);
  keyRef.current = location.key;

  useEffect(() => {
    if (!isTauri) return;
    let lastUrl = "";
    let lastAt = 0;
    const apply = (url: string) => {
      const now = Date.now();
      if (url === lastUrl && now - lastAt < 800) return;
      lastUrl = url;
      lastAt = now;
      try {
        const parsed = new URL(url);
        const target = parsed.hostname || parsed.pathname.replace(/^\/+/, "");
        if (target === "add") {
          const nav = navigateRef.current;
          if (pathnameRef.current === "/add" && keyRef.current !== "default") {
            // 热重入：已在记一笔，替换即可，不叠栈
            nav("/add", { replace: true });
          } else if (keyRef.current === "default") {
            // 冷启动（含深链 hash 合并进初始条目的竞态）：栈底固定为首页，再压入记一笔
            // 冷启动没有可动画的旧页，关闭 View Transition，避免双重过渡
            nav("/", { replace: true, viewTransition: false });
            nav("/add", { viewTransition: false });
          } else {
            nav("/add");
          }
        }
      } catch {
        /* 非法 url 忽略 */
      }
    };
    void getCurrent()
      .then((urls) => {
        if (urls && urls.length > 0) apply(urls[urls.length - 1]);
      })
      .catch(() => {});
    let unlisten: (() => void) | undefined;
    void onOpenUrl((urls) => {
      if (urls.length > 0) apply(urls[urls.length - 1]);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
    // 故意空依赖：只订阅一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * 路由布局：按 pathname+search 重挂载页面。
 * - data router + route-level lazy：导航提交前模块已加载，View Transition 不会截到空白 fallback
 * - 支持 View Transition 时交给 data router；不支持时用 CSS page-in-forward/back 兜底
 * - Android 返回键/手势走 popstate，capture 阶段先写 back 方向，再让 router 启动 POP 过渡
 */
function AnimatedLayout() {
  const location = useLocation();
  const navigate = useAppNavigate();
  useDeepLinkNavigate(navigate);

  useEffect(() => {
    const onPopState = () => {
      document.documentElement.dataset.navDir = "back";
    };
    window.addEventListener("popstate", onPopState, true);
    return () => window.removeEventListener("popstate", onPopState, true);
  }, []);

  const direction =
    document.documentElement.dataset.navDir === "back" ? "back" : "forward";
  const pageKey = `${location.pathname}${location.search}`;
  // 方向绑定到本次 location：data router 在 lazy 载入期间可能用旧 location
  // 触发一次 context 重渲染，不能让它把旧页的 fallback 动画方向改掉并重放。
  const directionRef = useRef<{
    key: string;
    direction: "forward" | "back";
  } | null>(null);
  if (!directionRef.current || directionRef.current.key !== pageKey) {
    directionRef.current = { key: pageKey, direction };
  }
  const pageDirection = directionRef.current.direction;
  const pageClass = supportsViewTransitions
    ? "h-full"
    : `page-in-${pageDirection} h-full`;

  return (
    // key 同时包含 search：/add?id=N → /add 这类同 pathname 的热深链也会重挂载、清掉旧表单
    <div key={pageKey} className={pageClass}>
      <div className="app-shell">
        <Outlet />
      </div>
    </div>
  );
}

const lazyAddBill = async () => {
  const { AddBill } = await import("./pages/AddBill");
  return { Component: AddBill };
};
const lazyBills = async () => {
  const { Bills } = await import("./pages/Bills");
  return { Component: Bills };
};
const lazyBillDetail = async () => {
  const { BillDetail } = await import("./pages/BillDetail");
  return { Component: BillDetail };
};
const lazyStats = async () => {
  const { Stats } = await import("./pages/Stats");
  return { Component: Stats };
};
const lazySettings = async () => {
  const { Settings } = await import("./pages/Settings");
  return { Component: Settings };
};
const lazyCategories = async () => {
  const { Categories } = await import("./pages/Categories");
  return { Component: Categories };
};
const lazyBudget = async () => {
  const { Budget } = await import("./pages/Budget");
  return { Component: Budget };
};
const lazyStatsCategories = async () => {
  const { StatsCategories } = await import("./pages/StatsCategories");
  return { Component: StatsCategories };
};
const lazyCategoryBills = async () => {
  const { CategoryBills } = await import("./pages/CategoryBills");
  return { Component: CategoryBills };
};
const lazyLogs = async () => {
  const { Logs } = await import("./pages/Logs");
  return { Component: Logs };
};
const lazyBackups = async () => {
  const { Backups } = await import("./pages/Backups");
  return { Component: Backups };
};

const router = createHashRouter([
  {
    element: <AnimatedLayout />,
    hydrateFallbackElement: <div className="app-shell h-full bg-page" />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      { path: "add", lazy: lazyAddBill },
      { path: "bills", lazy: lazyBills },
      { path: "bill/:id", lazy: lazyBillDetail },
      { path: "stats", lazy: lazyStats },
      { path: "stats/categories", lazy: lazyStatsCategories },
      { path: "stats/category/:id", lazy: lazyCategoryBills },
      { path: "settings", lazy: lazySettings },
      { path: "categories", lazy: lazyCategories },
      { path: "budget", lazy: lazyBudget },
      { path: "logs", lazy: lazyLogs },
      { path: "backups", lazy: lazyBackups },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

/** data router 的默认 errorElement 会绕过 main.tsx 的 ErrorBoundary，这里补齐同款兜底 */
function RouteError() {
  const routeError = useRouteError();
  useEffect(() => {
    void logEvent("error", "app.route.error", {
      hash: window.location.hash,
      message: errorMessage(routeError),
    });
  }, [routeError]);

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

export default function App() {
  // applyPendingRestore 在校验失败时会清掉 pending 并留下标记，这里在 UI 就绪后提示一次
  useEffect(() => {
    let flag: string | null = null;
    try {
      flag = localStorage.getItem("bp:restore-error");
      if (flag) localStorage.removeItem("bp:restore-error");
    } catch {
      /* 隐私模式等场景忽略 */
    }
    if (flag) toast.show(i18n.t("backup.integrityFailed"), "error");
  }, []);

  return <RouterProvider router={router} />;
}
