import type { ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "../../lib/cn";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  children: ReactNode;
  /** 底部固定操作区（不会被内容滚动带走） */
  footer?: ReactNode;
}

/** 移动端底部弹层（Base UI Dialog 承担焦点陷阱/滚动锁/ESC） */
export function Sheet({ open, onOpenChange, title, children, footer }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="sheet-backdrop fixed inset-0 z-40 bg-overlay" />
        <Dialog.Popup
          className={cn(
            "sheet-popup fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col",
            "rounded-t-2xl bg-card pb-[env(safe-area-inset-bottom)]",
          )}
        >
          <div className="flex justify-center pt-2">
            <div className="h-1 w-10 rounded-full bg-line" />
          </div>
          {title != null && (
            <Dialog.Title className="px-4 pt-3 pb-2 text-center text-base font-semibold text-ink">
              {title}
            </Dialog.Title>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {children}
          </div>
          {footer != null && (
            <div className="border-t border-line px-4 py-3">{footer}</div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
