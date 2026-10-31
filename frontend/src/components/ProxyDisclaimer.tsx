import { FlaskConical, X } from "lucide-react";
import { useState } from "react";

const KEY = "origami.disclaimerDismissed";

function dismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Slim banner shown once per browser session (see docs/PLAN.md section 0): computed fitness is a
 * computational proxy, never evidence of folding or stability. Dismissal lasts until the session ends.
 */
export function ProxyDisclaimer() {
  const [hidden, setHidden] = useState(dismissedThisSession);
  if (hidden) return null;
  return (
    <div role="note" className="flex items-start gap-3 rounded-lg border border-accent/35 bg-accent-soft px-4 py-2.5 text-sm text-fg">
      <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-fg/90">
        <strong className="font-semibold text-fg">Computational proxy — not experimentally validated.</strong>{" "}
        Fitness scores come from replaceable, documented functions. They do not predict DNA folding, yield, or
        stability. Imported experimental measurements are shown separately with their provenance.
      </p>
      <button
        type="button"
        aria-label="Dismiss for this session"
        onClick={() => {
          try {
            sessionStorage.setItem(KEY, "1");
          } catch {
            /* storage unavailable: hide until reload */
          }
          setHidden(true);
        }}
        className="rounded p-1 text-subtle transition-colors duration-150 hover:bg-surface-raised hover:text-fg"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
