import { ChevronDown } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes } from "react";

import { cx } from "../../lib/cx";

const control =
  "w-full rounded-md border border-border bg-surface-sunken px-3 text-sm text-fg placeholder:text-subtle transition duration-150 " +
  "hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger";

/** Label + control. The visible label text is the control's accessible name. */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5 text-sm", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-subtle">{hint}</span>}
    </label>
  );
}

export function Input({ className, ref, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cx(control, "h-9", className)} {...rest} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <span className="relative flex">
      <select className={cx(control, "h-9 appearance-none pr-8", className)} {...rest}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-subtle" />
    </span>
  );
}

/** Native checkbox (keyboard and screen-reader behaviour for free) with a themed label. */
export function Checkbox({
  label,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2 text-sm text-fg has-[:disabled]:cursor-not-allowed", className)}>
      <input type="checkbox" className="size-4 rounded border-border" {...rest} />
      {label}
    </label>
  );
}
