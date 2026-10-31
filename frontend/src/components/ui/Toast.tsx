import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

import { cx } from "../../lib/cx";

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: ReactNode;
}

const ToastContext = createContext<((message: ReactNode, tone?: ToastTone) => void) | null>(null);
const DURATION_MS = 4000;

const STYLE: Record<ToastTone, { icon: ReactNode; className: string }> = {
  success: { icon: <CircleCheck className="size-4 text-success" />, className: "border-success/40" },
  error: { icon: <CircleAlert className="size-4 text-danger" />, className: "border-danger/40" },
  info: { icon: <Info className="size-4 text-info" />, className: "border-info/40" },
};

/**
 * Transient feedback ("Batch created", "Sequences copied"). The container is a polite live region; toasts
 * deliberately use no status/alert role so page-level status messages stay unique.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message: ReactNode, tone: ToastTone = "success") => {
      const id = next.current++;
      setToasts((t) => [...t.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-surface-raised px-3.5 py-3 text-sm text-fg shadow-[var(--shadow-raised)]",
              "motion-safe:animate-[oe-toast-in_180ms_ease-out]",
              STYLE[t.tone].className,
            )}
          >
            <span aria-hidden className="mt-0.5">
              {STYLE[t.tone].icon}
            </span>
            <span className="min-w-0 flex-1">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
              className="rounded p-0.5 text-subtle transition-colors hover:text-fg"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Show a toast. Outside a provider (e.g. isolated component tests) it is a no-op. */
export function useToast(): (message: ReactNode, tone?: ToastTone) => void {
  return useContext(ToastContext) ?? noop;
}
function noop() {}
