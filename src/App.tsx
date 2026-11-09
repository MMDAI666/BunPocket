import { useEffect, useRef } from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { Home } from "./pages/Home";
import { AddBill } from "./pages/AddBill";
import { Bills } from "./pages/Bills";
import { Stats } from "./pages/Stats";
import { Settings } from "./pages/Settings";
import { Categories } from "./pages/Categories";
import { Budget } from "./pages/Budget";

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
    <div key={location.pathname} className="page-in h-full">
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
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AnimatedRoutes />
    </HashRouter>
  );
}
