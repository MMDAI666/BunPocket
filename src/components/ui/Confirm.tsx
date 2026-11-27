import { useTranslation } from "react-i18next";
import { AlertDialog } from "@base-ui/react/alert-dialog";

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  content?: string;
  danger?: boolean;
  onConfirm: () => void;
}

/** 居中确认框（Base UI AlertDialog） */
export function Confirm({
  open,
  onOpenChange,
  title,
  content,
  danger = false,
  onConfirm,
}: ConfirmProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="zoom-backdrop fixed inset-0 z-50 bg-overlay" />
        <div className="fixed inset-0 z-50 flex items-center justify-center px-8">
          <AlertDialog.Popup className="zoom-popup w-full max-w-72 rounded-[16px] border border-line bg-card p-5 text-center">
            {title != null && (
              <AlertDialog.Title className="text-[15px] font-semibold text-ink">
                {title}
              </AlertDialog.Title>
            )}
            {content != null && (
              <AlertDialog.Description className="mt-2 text-[13px] leading-6 text-ink-2">
                {content}
              </AlertDialog.Description>
            )}
            <div className="mt-5 flex gap-2.5">
              <AlertDialog.Close
                className="flex-1 rounded-[10px] border border-line py-2.5 text-[13px] text-ink-2 transition-colors hover:bg-chip"
                aria-label={t("common.cancel")}
              >
                {t("common.cancel")}
              </AlertDialog.Close>
              <button
                type="button"
                className={
                  danger
                    ? "flex-1 rounded-[10px] bg-danger py-2.5 text-[13px] font-medium text-white"
                    : "flex-1 rounded-[10px] bg-book py-2.5 text-[13px] font-medium text-cream"
                }
                onClick={() => {
                  onConfirm();
                  onOpenChange(false);
                }}
              >
                {t("common.ok")}
              </button>
            </div>
          </AlertDialog.Popup>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
