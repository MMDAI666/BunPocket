import { Toast } from "@base-ui/react/toast";

// 全局命令式 toast：toast.show("已保存") / toast.show("失败", "error")
const manager = Toast.createToastManager<{ type?: string }>();

export const toast = {
  show: (message: string, type: "success" | "error" = "success") =>
    manager.add({ title: message, type, timeout: 2000 }),
};

function ToastViewport() {
  const { toasts } = Toast.useToastManager<{ type?: string }>();
  return (
    <Toast.Portal>
      <div className="pointer-events-none fixed inset-x-0 top-5 z-[90] flex flex-col items-center gap-2 px-8">
        {toasts.map((item) => (
          <Toast.Root
            key={item.id}
            toast={item}
            className="toast-item pointer-events-auto max-w-full truncate rounded-full bg-ink px-4 py-2 text-sm text-card shadow-lg"
          >
            <Toast.Title>{item.title}</Toast.Title>
          </Toast.Root>
        ))}
      </div>
    </Toast.Portal>
  );
}

/** 挂在应用根部一次 */
export function ToastHost() {
  return (
    <Toast.Provider toastManager={manager}>
      <ToastViewport />
    </Toast.Provider>
  );
}
