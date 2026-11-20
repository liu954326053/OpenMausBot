import { useEffect, useRef, type ReactNode } from "react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/**
 * The one dialog every template-sync action shows: its changes, then a confirm that runs only on the person's word.
 * Update, save back and the two deposits all pour their body into it, so there is one review, not four. The focus trap
 * is the app's own (see bot-settings SkillReviewDialog): Esc closes unless something is running, Tab stays inside.
 */
export function ReviewDialog({
  titleId, title, confirmLabel, confirmTone = "accent", busy = false, canConfirm = true, showCancel = true, error, onConfirm, onClose, children,
}: {
  titleId: string;
  title: string;
  confirmLabel: string;
  confirmTone?: "accent" | "danger";
  busy?: boolean;
  canConfirm?: boolean;
  /** Hidden once the action is done and only a close remains. */
  showCancel?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const parentDialog = dialog?.parentElement?.closest<HTMLElement>('[role="dialog"]');
    dialog?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) close.current();
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previousFocus && previousFocus !== document.body && previousFocus.isConnected) previousFocus.focus();
      else parentDialog?.focus();
    };
  }, [busy]);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-6"
    >
      <div className="flex max-h-[min(760px,90vh)] w-full max-w-lg flex-col rounded-2xl bg-card p-5 shadow-2xl">
        <div id={titleId} className="text-[16px] font-semibold text-ink">{title}</div>
        <div className="mt-3 min-h-0 flex-1 overflow-auto text-[13px] leading-relaxed text-ink">{children}</div>
        {error && <div role="alert" className="mt-3 text-[12px] text-danger">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          {showCancel && (
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[13px] font-medium text-ink-secondary hover:bg-raised disabled:opacity-40"
            >
              {t("common.cancel")}
            </button>
          )}
          <button
            type="button"
            disabled={busy || !canConfirm}
            onClick={onConfirm}
            className={cn(
              "rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40",
              confirmTone === "danger" ? "bg-danger" : "bg-accent",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
