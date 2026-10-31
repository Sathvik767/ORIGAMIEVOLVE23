import { useId, type ReactNode } from "react";

import { cx } from "../../lib/cx";

export const cardClass = "rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]";

/**
 * Surface container. With a `title` it renders a <section> labelled by its heading (an ARIA region),
 * so pages and tests can address it by name.
 */
export function Card({
  title,
  description,
  actions,
  icon,
  children,
  className,
  bodyClassName,
  headingLevel = 2,
  as,
  "aria-label": ariaLabel,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  headingLevel?: 2 | 3;
  as?: "section" | "aside" | "div";
  "aria-label"?: string;
}) {
  const id = useId();
  const Tag = as ?? (title ? "section" : "div");
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <Tag
      aria-labelledby={title && !ariaLabel ? `${id}-title` : undefined}
      aria-label={ariaLabel}
      className={cx(cardClass, "min-w-0", className)}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              {title && (
                <Heading id={`${id}-title`} className="text-base font-semibold tracking-tight text-fg">
                  {title}
                </Heading>
              )}
              {description && <div className="mt-0.5 text-sm text-muted">{description}</div>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cx("p-5", bodyClassName)}>{children}</div>
    </Tag>
  );
}
