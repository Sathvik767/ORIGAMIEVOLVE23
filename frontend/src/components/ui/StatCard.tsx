import type { ReactNode } from "react";

import { cx } from "../../lib/cx";
import type { Tone } from "./Badge";

const ICON_TONES: Record<Tone, string> = {
  neutral: "bg-surface-raised text-muted",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-accent-soft text-accent",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

/**
 * One metric. Render inside a <dl>: the label is a <dt> immediately followed by the value <dd>,
 * so assistive tech (and tests) can pair them.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cx("relative min-w-0 rounded-lg border border-border bg-surface-raised/60 px-4 py-3", className)}>
      <dt className="pr-9 text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-fg">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
      {icon && (
        <span aria-hidden className={cx("absolute top-3 right-3 grid size-7 place-items-center rounded-md", ICON_TONES[tone])}>
          {icon}
        </span>
      )}
    </div>
  );
}
