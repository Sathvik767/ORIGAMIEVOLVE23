import type { ReactNode } from "react";

import { cx } from "../../lib/cx";

/**
 * Visual tooltip shown on hover and keyboard focus. It is decorative (aria-hidden): the wrapped control must
 * carry its own accessible name, e.g. an icon button's aria-label.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  /** "end" anchors the tooltip to the right edge (for controls at the edge of the screen). */
  align?: "center" | "end";
}) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        aria-hidden
        className={cx(
          "pointer-events-none absolute z-50 rounded-md border border-border bg-surface-raised px-2 py-1",
          "text-xs font-medium whitespace-nowrap text-fg opacity-0 shadow-[var(--shadow-raised)] transition-opacity duration-150",
          "group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
        )}
      >
        {content}
      </span>
    </span>
  );
}
