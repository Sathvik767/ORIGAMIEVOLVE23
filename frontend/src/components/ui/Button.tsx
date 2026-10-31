import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cx } from "../../lib/cx";
import { Tooltip } from "./Tooltip";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary-strong text-primary-fg hover:brightness-110 shadow-sm",
  secondary: "border border-border bg-surface-raised text-fg hover:border-border-strong hover:bg-surface",
  ghost: "text-muted hover:bg-surface-raised hover:text-fg",
  danger: "border border-danger/40 bg-danger-soft text-danger hover:border-danger/70",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
};

export const buttonClass = (variant: Variant = "secondary", size: Size = "md", extra?: string) =>
  cx(
    "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition duration-150",
    "disabled:pointer-events-none disabled:opacity-45",
    VARIANTS[variant],
    SIZES[size],
    extra,
  );

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/** Square icon-only button; `label` is its accessible name and its tooltip. */
export function IconButton({
  label,
  icon,
  variant = "ghost",
  className,
  ...rest
}: Omit<ButtonProps, "children" | "aria-label"> & { label: string; icon: ReactNode }) {
  return (
    <Tooltip content={label}>
      <Button aria-label={label} variant={variant} size="sm" className={cx("w-8 px-0", className)} icon={icon} {...rest} />
    </Tooltip>
  );
}
