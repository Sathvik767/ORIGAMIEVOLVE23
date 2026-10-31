import type { ReactNode } from "react";

import { cx } from "../../lib/cx";
import type { Tone } from "./Badge";

const BAR_TONES: Record<Tone, string> = {
  neutral: "bg-subtle",
  primary: "bg-primary-strong",
  success: "bg-success",
  warning: "bg-accent",
  danger: "bg-danger",
  info: "bg-info",
};

/** Determinate progress (0..max), announced as a progressbar. */
export function ProgressBar({
  value,
  max = 1,
  label,
  tone = "primary",
  className,
  segments,
}: {
  value: number;
  max?: number;
  label: string;
  tone?: Tone;
  className?: string;
  /** Optional stacked segments (e.g. completed / failed) drawn instead of a single bar. */
  segments?: { value: number; tone: Tone }[];
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, max > 0 ? (v / max) * 100 : 0))}%`;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cx("flex h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken ring-1 ring-border/60", className)}
    >
      {segments ? (
        segments.map((s, i) => (
          <div key={i} className={cx("h-full transition-[width] duration-200", BAR_TONES[s.tone])} style={{ width: pct(s.value) }} />
        ))
      ) : (
        <div className={cx("h-full rounded-full transition-[width] duration-200", BAR_TONES[tone])} style={{ width: pct(value) }} />
      )}
    </div>
  );
}

/** Shimmering placeholder while data loads (hidden from assistive tech; pair with an sr-only label). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cx(
        "rounded-md bg-[linear-gradient(90deg,var(--color-surface-raised)_0%,var(--color-border)_50%,var(--color-surface-raised)_100%)]",
        "bg-[length:200%_100%] motion-safe:animate-[oe-shimmer_1.4s_ease-in-out_infinite]",
        className,
      )}
    />
  );
}

/** A block of skeleton rows with a screen-reader label, used instead of "Loading…" text. */
export function LoadingBlock({ label = "Loading…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div aria-busy="true" className="space-y-2.5">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cx("h-4", i % 3 === 2 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-8 text-center", className)}>
      <span aria-hidden className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary">
        {icon}
      </span>
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const CALLOUT_TONES: Record<Tone, string> = {
  neutral: "border-border bg-surface-raised text-fg",
  primary: "border-primary/30 bg-primary-soft text-fg",
  success: "border-success/30 bg-success-soft text-fg",
  warning: "border-accent/40 bg-accent-soft text-fg",
  danger: "border-danger/40 bg-danger-soft text-fg",
  info: "border-info/30 bg-info-soft text-fg",
};
const CALLOUT_ICON: Record<Tone, string> = {
  neutral: "text-muted",
  primary: "text-primary",
  success: "text-success",
  warning: "text-accent",
  danger: "text-danger",
  info: "text-info",
};

/** Tinted message box. Pass `role` explicitly ("alert", "note", "status") only where the semantics apply. */
export function Callout({
  tone = "info",
  icon,
  title,
  children,
  action,
  role,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  role?: "alert" | "note" | "status";
  className?: string;
}) {
  return (
    <div role={role} className={cx("flex gap-3 rounded-lg border px-4 py-3 text-sm", CALLOUT_TONES[tone], className)}>
      {icon && (
        <span aria-hidden className={cx("mt-0.5 shrink-0 [&_svg]:size-4", CALLOUT_ICON[tone])}>
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(Boolean(title) && "mt-0.5", "text-fg/90")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/** Page title row: title, one-line description and actions. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium tracking-wide text-primary uppercase">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
