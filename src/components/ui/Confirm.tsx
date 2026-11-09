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
        <div className="fixed inset-0 z-50 flex items-center justify-center px-10">
          <AlertDialog.Popup className="zoom-popup w-full max-w-72 rounded-2xl bg-card p-5 text-center">
            {title != null && (
              <AlertDialog.Title className="text-base font-semibold text-ink">
                {title}
              </AlertDialog.Title>
            )}
            {content != null && (
              <AlertDialog.Description className="mt-2 text-sm text-ink-2">
                {content}
              </AlertDialog.Description>
            )}
            <div className="mt-5 flex gap-3">
              <AlertDialog.Close
                className="flex-1 rounded-full border border-line py-2 text-sm text-ink-2"
                aria-label={t("common.cancel")}
              >
                {t("common.cancel")}
              </AlertDialog.Close>
              <button
                type="button"
                className={
                  danger
                    ? "flex-1 rounded-full bg-danger py-2 text-sm font-medium text-white"
                    : "flex-1 rounded-full bg-gradient-to-r from-brand-1 to-brand-2 py-2 text-sm font-medium text-white"
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
