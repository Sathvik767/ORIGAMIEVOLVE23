import { Download, Pause, Play, X } from "lucide-react";
import { lazy, Suspense, useState, type ReactNode, type RefObject } from "react";

import type { DesignOut } from "../../api/client";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { IconButton } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Feedback";
import { Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";
import { CanvasCard, Swatch, useSceneColors } from "./CanvasCard";
import { MISSING_STRUCTURE } from "./geometry";
import {
  BACKBONE_RADIUS_NM,
  BASE_COLORS,
  BP_PER_TURN,
  gaStatus,
  HELIX_COLORS,
  HELIX_SPACING_NM,
  LATTICES,
  RISE_NM,
  type ColorMode,
  type IdealHelixModel,
  type IdealStaple,
  type Lattice,
} from "./idealHelix";
import type { SceneHandle } from "./sceneTypes";

// Three.js is only downloaded when this scene is actually shown.
const IdealHelixScene3D = lazy(() => import("./IdealHelixScene3D").then((m) => ({ default: m.IdealHelixScene3D })));

export const HELIX_BANNER =
  "Idealized B-DNA model generated from helix/start/end and the lattice you chose. Not a molecular structure: helix arrangement, crossovers and scaffold routing are not in the data.";

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Details of the hovered (or clicked, pinned) staple. */
function StapleCard({ staple, hasResult, pinned, onClose }: { staple: IdealStaple; hasResult: boolean; pinned: boolean; onClose: () => void }) {
  const bp = staple.end - staple.start + 1;
  return (
    <div
      aria-label="Selected staple"
      role="group"
      className="pointer-events-auto absolute right-3 bottom-16 z-10 w-64 rounded-lg border border-border bg-surface/95 p-3 text-xs shadow-[var(--shadow-raised)] backdrop-blur"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-sm font-semibold text-fg">{staple.id}</p>
        {pinned && (
          <button type="button" aria-label="Clear selection" onClick={onClose} className="rounded p-0.5 text-subtle hover:text-fg">
            <X aria-hidden className="size-3.5" />
          </button>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted">Helix</dt>
        <dd className="font-mono">{staple.helix}</dd>
        <dt className="text-muted">Start–end</dt>
        <dd className="font-mono">
          {staple.start}–{staple.end}
        </dd>
        <dt className="text-muted">Length</dt>
        <dd className="font-mono">
          {bp} nt ({staple.lengthNm.toFixed(2)} nm)
        </dd>
        <dt className="text-muted">GA</dt>
        <dd>
          <span className="mr-1 inline-block size-2 rounded-full align-middle" style={{ background: staple.color }} aria-hidden />
          {gaStatus(staple, hasResult)}
        </dd>
      </dl>
      {!pinned && <p className="mt-2 text-subtle">Click to keep this panel open.</p>}
    </div>
  );
}

export function HelixView({
  design,
  model,
  hasResult,
  sceneRef,
  modeToggle,
  lattice,
  onLattice,
}: {
  design: DesignOut;
  model: IdealHelixModel;
  hasResult: boolean;
  sceneRef: RefObject<SceneHandle | null>;
  modeToggle: ReactNode;
  lattice: Lattice;
  onLattice: (l: Lattice) => void;
}) {
  const colors = useSceneColors();
  const toast = useToast();
  const [reducedMotion] = useState(prefersReducedMotion);
  const [autoRotate, setAutoRotate] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>("base");
  const [hovered, setHovered] = useState<IdealStaple | null>(null);
  const [pinned, setPinned] = useState<IdealStaple | null>(null);
  const shown = pinned ?? hovered;

  function download() {
    const url = sceneRef.current?.snapshot?.();
    if (!url) {
      toast("The 3D view is not ready to export yet.", "error");
      return;
    }
    const a = Object.assign(document.createElement("a"), { href: url, download: `${design.external_id}-ideal-helix-${lattice}.png` });
    a.click();
    toast("PNG downloaded");
  }

  return (
    <CanvasCard
      headingId="helix-heading"
      title="3D view: idealized helix model"
      sceneRef={sceneRef}
      modeToggle={modeToggle}
      note={
        <p role="note" className="max-w-xl rounded-lg border border-accent/40 bg-surface/90 px-3 py-1.5 text-xs text-fg shadow-sm backdrop-blur">
          {HELIX_BANNER}
        </p>
      }
      tools={
        <>
          <IconButton
            label={reducedMotion ? "Auto-rotate (off: reduced motion)" : autoRotate ? "Stop auto-rotate" : "Auto-rotate"}
            aria-pressed={autoRotate}
            disabled={reducedMotion}
            icon={autoRotate ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
            onClick={() => setAutoRotate((r) => !r)}
          />
          <Select aria-label="Lattice" value={lattice} onChange={(e) => onLattice(e.target.value as Lattice)} className="h-8 w-32 text-xs">
            {LATTICES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Colour mode" value={colorMode} onChange={(e) => setColorMode(e.target.value as ColorMode)} className="h-8 w-32 text-xs">
            <option value="base">By base</option>
            <option value="strand">By strand</option>
          </Select>
          <IconButton label="Download PNG" icon={<Download aria-hidden className="size-4" />} onClick={download} />
        </>
      }
      legend={
        <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1">
          <Swatch color={HELIX_COLORS.scaffold}>scaffold</Swatch>
          {hasResult ? (
            <>
              <Swatch color={HELIX_COLORS.original}>staple: original kept</Swatch>
              <Swatch color={HELIX_COLORS["selected-variant"]}>staple: GA chose a supplied variant</Swatch>
              <Swatch color={HELIX_COLORS["not-optimized"]}>staple: no variants (not optimized)</Swatch>
            </>
          ) : (
            <Swatch color={HELIX_COLORS.original}>staple</Swatch>
          )}
          {colorMode === "base" ? (
            <>
              <li className="text-subtle">base pairs by scaffold base:</li>
              {Object.entries(BASE_COLORS).map(([b, c]) => (
                <Swatch key={b} color={c}>
                  {b}
                </Swatch>
              ))}
            </>
          ) : (
            <li className="text-subtle">base pairs coloured by staple</li>
          )}
          <li className="text-subtle">crossovers and scaffold routing: not drawn (not in the data)</li>
        </ul>
      }
      footer={
        <div className="grid gap-3 md:grid-cols-2">
          <p>
            Textbook B-DNA: {RISE_NM} nm rise and {BP_PER_TURN} bp per turn, {BACKBONE_RADIUS_NM.toFixed(1)} nm backbone radius, staple strand
            offset 144° (minor groove), helix centres {HELIX_SPACING_NM} nm apart on the chosen lattice ({model.helices.length} helices,{" "}
            {model.placedCount} of {model.stapleCount} staples placed). Hover or click a staple for details. Drag to rotate · scroll to zoom ·
            right-drag to pan.
          </p>
          <div>
            <p className="font-semibold text-fg">Not available in the current data:</p>
            <ul className="mt-1 list-disc pl-5">
              {MISSING_STRUCTURE.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        </div>
      }
    >
      <ErrorBoundary
        key={design.id}
        fallback={(e) => (
          <p role="alert" className="p-4 pt-24 text-sm text-danger">
            3D rendering is unavailable in this browser ({e.message}). Check that WebGL is enabled.
          </p>
        )}
      >
        <Suspense
          fallback={
            <div className="absolute inset-0 p-6 pt-24">
              <span className="sr-only">Loading 3D renderer…</span>
              <Skeleton className="h-full w-full rounded-lg" />
            </div>
          }
        >
          <IdealHelixScene3D
            key={design.id}
            ref={sceneRef}
            model={model}
            background={colors.background}
            colorMode={colorMode}
            autoRotate={autoRotate && !reducedMotion}
            highlight={shown?.id ?? null}
            onPick={(s, pin) => {
              if (pin) setPinned(s);
              else setHovered(s);
            }}
          />
        </Suspense>
      </ErrorBoundary>
      {shown && <StapleCard staple={shown} hasResult={hasResult} pinned={Boolean(pinned)} onClose={() => setPinned(null)} />}
    </CanvasCard>
  );
}
