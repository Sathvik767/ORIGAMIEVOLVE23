import type { ReactNode } from "react";

import { cx } from "../../lib/cx";

/**
 * Styles a plain <table> placed inside it: the table scrolls horizontally within its card (never the page),
 * with an optional sticky header, row hover and zebra striping.
 */
export function Table({
  children,
  sticky = false,
  zebra = false,
  maxHeight,
  className,
  label,
}: {
  children: ReactNode;
  sticky?: boolean;
  zebra?: boolean;
  maxHeight?: string;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      className={cx("-mx-5 overflow-x-auto px-5", maxHeight && "overflow-y-auto", className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <div
        className={cx(
          "[&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-sm",
          "[&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-medium [&_th]:tracking-wide [&_th]:text-muted [&_th]:uppercase [&_th]:whitespace-nowrap",
          "[&_td]:border-b [&_td]:border-border/60 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle",
          "[&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-150 [&_tbody_tr:hover]:bg-surface-raised/70",
          sticky && "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-surface",
          zebra && "[&_tbody_tr:nth-child(even)]:bg-surface-sunken/60",
          "[&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}
