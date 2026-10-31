import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cx } from "../../lib/cx";

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

/** WAI-ARIA tabs: arrow keys / Home / End move between tabs; only the active tab is in the tab order. */
export function Tabs({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = Math.max(
    0,
    items.findIndex((t) => t.id === value),
  );

  function onKey(e: KeyboardEvent) {
    const last = items.length - 1;
    const next =
      e.key === "ArrowRight" ? (active + 1) % items.length : e.key === "ArrowLeft" ? (active - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next]!.id);
    refs.current[next]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-1 overflow-x-auto border-b border-border">
        {items.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-150",
              i === active ? "border-primary text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {items.map((t, i) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={i !== active}
          className="pt-4"
        >
          {i === active && t.content}
        </div>
      ))}
    </div>
  );
}
