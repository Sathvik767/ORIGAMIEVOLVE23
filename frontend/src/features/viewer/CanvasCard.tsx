import { Eye, EyeOff, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";

import { useTheme } from "../../components/ThemeContext";
import { IconButton } from "../../components/ui/Button";
import { cardClass } from "../../components/ui/Card";
import { cx } from "../../lib/cx";
import { BAR_COLORS, BAR_COLORS_DARK, type SceneHandle } from "./sceneTypes";

/** Scene colours per theme (three.js needs concrete colours, not CSS variables). */
export function useSceneColors() {
  const { theme } = useTheme();
  return theme === "dark"
    ? { background: "#0d141b", guide: "#34465b", bars: BAR_COLORS_DARK }
    : { background: "#eef2f6", guide: "#cbd5e1", bars: BAR_COLORS };
}

export type ViewMode = "molecular" | "helix" | "schematic";

export const MODE_LABELS: Record<ViewMode, string> = {
  molecular: "Molecular (oxDNA coordinates)",
  helix: "Idealized helix model",
  schematic: "Schematic (index space)",
};

/** Segmented view-mode switch (a radio group, so each option keeps its accessible name). */
export function ModeToggle({ mode, onMode, modes }: { mode: ViewMode; onMode: (m: ViewMode) => void; modes: ViewMode[] }) {
  const option = (value: ViewMode, label: string) => (
    <label
      key={value}
      className={cx(
        "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary",
        mode === value ? "bg-primary-strong text-primary-fg" : "text-muted hover:text-fg",
      )}
    >
      <input type="radio" name="view-mode" className="sr-only" checked={mode === value} onChange={() => onMode(value)} />
      {label}
    </label>
  );
  return (
    <div role="radiogroup" aria-label="View mode" className="flex gap-0.5 rounded-lg border border-border bg-surface/90 p-0.5 shadow-sm backdrop-blur">
      {modes.map((m) => option(m, MODE_LABELS[m]))}
    </div>
  );
}

/**
 * Full-width scene card: the canvas fills it, with a floating toolbar (zoom, reset, legend toggle, optional
 * view-mode switch), an overlaid label saying what is drawn, and the legend over the bottom edge.
 */
export function CanvasCard({
  headingId,
  title,
  sceneRef,
  note,
  modeToggle,
  legend,
  children,
  footer,
  tools,
  showControls = true,
}: {
  headingId: string;
  title: string;
  sceneRef: RefObject<SceneHandle | null>;
  note?: ReactNode;
  modeToggle?: ReactNode;
  legend?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra controls appended to the floating toolbar (e.g. lattice, colour mode, download). */
  tools?: ReactNode;
  showControls?: boolean;
}) {
  const [legendOpen, setLegendOpen] = useState(true);
  return (
    <section aria-labelledby={headingId} className={cx(cardClass, "min-w-0 overflow-hidden")}>
      <h2 id={headingId} className="sr-only">
        {title}
      </h2>
      <div className="relative h-[min(68vh,560px)] min-h-[360px] bg-surface-sunken">
        {children}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
          <div className="pointer-events-auto flex max-w-[70%] flex-col items-start gap-2">
            {modeToggle}
            {note}
          </div>
          {showControls && (
            <div
              role="toolbar"
              aria-label="Scene controls"
              className="pointer-events-auto flex flex-wrap items-center justify-end gap-0.5 rounded-lg border border-border bg-surface/90 p-0.5 shadow-sm backdrop-blur"
            >
              <IconButton label="Zoom in" icon={<ZoomIn aria-hidden className="size-4" />} onClick={() => sceneRef.current?.zoom(1.25)} />
              <IconButton label="Zoom out" icon={<ZoomOut aria-hidden className="size-4" />} onClick={() => sceneRef.current?.zoom(0.8)} />
              <IconButton label="Reset view" icon={<Maximize aria-hidden className="size-4" />} onClick={() => sceneRef.current?.reset()} />
              {tools}
              {legend && (
                <IconButton
                  label={legendOpen ? "Hide legend" : "Show legend"}
                  aria-pressed={legendOpen}
                  icon={legendOpen ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
                  onClick={() => setLegendOpen((o) => !o)}
                />
              )}
            </div>
          )}
        </div>
        {legend && legendOpen && (
          <div className="pointer-events-auto absolute inset-x-3 bottom-3 rounded-lg border border-border bg-surface/90 px-3 py-2 text-xs text-muted shadow-sm backdrop-blur">
            {legend}
          </div>
        )}
      </div>
      {footer && <div className="border-t border-border px-5 py-3 text-xs text-muted">{footer}</div>}
    </section>
  );
}

/** One colour swatch + label for the scene legends. */
export function Swatch({ color, children }: { color: string; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-2 w-4 rounded-sm" style={{ background: color }} />
      {children}
    </li>
  );
}
