import { lazy, Suspense, useEffect, useRef } from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { toast } from "./components/ui/Toast";
import i18n from "./i18n";
import { Home } from "./pages/Home";

// 首屏只保留首页；其余页面按路由懒加载，避免 ECharts 等重依赖进入首包
const AddBill = lazy(() =>
  import("./pages/AddBill").then((m) => ({ default: m.AddBill })),
);
const Bills = lazy(() =>
  import("./pages/Bills").then((m) => ({ default: m.Bills })),
);
const Stats = lazy(() =>
  import("./pages/Stats").then((m) => ({ default: m.Stats })),
);
const Settings = lazy(() =>
  import("./pages/Settings").then((m) => ({ default: m.Settings })),
);
const Categories = lazy(() =>
  import("./pages/Categories").then((m) => ({ default: m.Categories })),
);
const Budget = lazy(() =>
  import("./pages/Budget").then((m) => ({ default: m.Budget })),
);

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 深链导航：bunpocket://add → /add。冷启动靠 getCurrent、热启动靠 onOpenUrl，
 * 冷启动时两者先后报同一 URL，用时间窗去重；已在 /add 时用 replace 防叠栈。
 * 订阅必须只在挂载时注册一次——重新订阅会让插件重放缓存的深链 URL，
 * 造成"返回首页瞬间被拽回 /add"的弹回循环（曾用 CDP 实锤）。
 * 栈结构约定：组件进入也要保证 桌面→首页→记一笔，初始条目上先落首页再压记一笔。 */
function useDeepLinkNavigate(navigate: ReturnType<typeof useNavigate>) {
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
            nav("/", { replace: true });
            nav("/add");
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

/** 以 pathname 为 key 重挂载，触发 page-in 过渡动画 */
function AnimatedRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  useDeepLinkNavigate(navigate);
  return (
    // key 同时包含 search：/add?id=N → /add 这类同 pathname 的热深链也会重挂载、清掉旧表单
    <div key={`${location.pathname}${location.search}`} className="page-in h-full">
      <Suspense fallback={<div className="h-full bg-page" />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/add" element={<AddBill />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
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

  return (
    <HashRouter>
      <AnimatedRoutes />
    </HashRouter>
  );
}
