import type { ReactNode } from "react";

import { cx } from "../../lib/cx";

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

export const TONES: Record<Tone, string> = {
  neutral: "border-border bg-surface-raised text-muted",
  primary: "border-primary/30 bg-primary-soft text-primary",
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-accent/35 bg-accent-soft text-accent",
  danger: "border-danger/35 bg-danger-soft text-danger",
  info: "border-info/30 bg-info-soft text-info",
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
