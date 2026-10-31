/**
 * Idealized B-DNA helix model, built only from data the design contains: each staple's helix index and
 * start..end positions, and the scaffold sequence (for base colours). It is a DISPLAY MODEL, not a structure.
 *
 * Textbook B-DNA constants used (all in nm / degrees):
 *   RISE_NM            = 0.34    axial rise per base pair
 *   BP_PER_TURN        = 10.5    base pairs per helical turn
 *   TWIST_DEG          = 360 / 10.5 = 34.2857…° twist per base pair
 *   BACKBONE_RADIUS_NM = 1.0     radius of the sugar-phosphate backbone around the helix axis
 *   MINOR_GROOVE_DEG   = 144     angular offset of the complementary (staple) strand from the scaffold strand
 *   HELIX_SPACING_NM   = 2.25    distance between neighbouring helix centres (an assumption for display;
 *                                origami lattices are typically ~2.25–2.6 nm)
 *
 * Coordinates: the helix axis runs along x. Base position i (a scaffold index, as in the staple start/end
 * columns) sits at x = (i - centre) * RISE_NM. Helix centres lie in the y–z plane on the lattice the user
 * chooses. Mapping helix index → lattice position (deterministic, documented):
 *   1. The design's distinct helix indices are sorted ascending; helix k-th in that order has rank k.
 *   2. "single row": column = rank, row = 0.
 *      "square" and "honeycomb": C = ceil(sqrt(number of helices)) columns; row = floor(rank / C),
 *      column = rank % C (row-major).
 *   3. square:    (y, z) = (column * S, row * S)
 *      honeycomb: (y, z) = (column * S * √3/2, row * 1.5 S + (row + column odd ? S/2 : 0)), which gives every
 *                 helix up to three neighbours at exactly S, as in a honeycomb lattice.
 *   4. The whole bundle is centred on the origin.
 * This is NOT the design's real helix arrangement: the data contains helix indices only.
 *
 * Not modelled because the data does not contain them: crossovers between helices, scaffold routing between
 * helices, loops/skips, sequence-dependent geometry. Nothing is inferred to fill these in.
 */

import type { DesignOut, OptimizationResult } from "../../api/client";
import type { BarVariant } from "./geometry";

export const RISE_NM = 0.34;
export const BP_PER_TURN = 10.5;
export const TWIST_DEG = 360 / BP_PER_TURN;
export const BACKBONE_RADIUS_NM = 1.0;
export const MINOR_GROOVE_DEG = 144;
export const HELIX_SPACING_NM = 2.25;

export type Lattice = "honeycomb" | "square" | "single-row";
export const LATTICES: { value: Lattice; label: string }[] = [
  { value: "honeycomb", label: "Honeycomb" },
  { value: "square", label: "Square" },
  { value: "single-row", label: "Single row" },
];
export type ColorMode = "base" | "strand";
export type Vec3 = [number, number, number];

/** Colours of the idealized model (scene-only; must stay in sync with the legend). */
export const HELIX_COLORS = {
  scaffold: "#3b82f6", // blue
  original: "#14b8a6", // teal: staple, original sequence kept (or no optimization result)
  "selected-variant": "#f59e0b", // amber: the GA chose a supplied variant for this staple
  "not-optimized": "#94a3b8", // grey: staple without variants (fixed)
} as const;
export const BASE_COLORS: Record<string, string> = {
  A: "#ef4444", // red
  T: "#22c55e", // green
  G: "#eab308", // yellow
  C: "#3b82f6", // blue
};
export const UNKNOWN_BASE_COLOR = "#64748b"; // no scaffold base at that index

export interface HelixStrand {
  points: Vec3[]; // one backbone point per base, in index order
  start: number;
  end: number;
  lengthNm: number; // (end - start + 1) * RISE_NM
}

export interface IdealStaple extends HelixStrand {
  id: string;
  helix: number;
  variant: BarVariant;
  color: string;
  /** GA choice for this staple (0 = original, k = supplied variant k); undefined without a result. */
  choice?: number;
}

export interface Rung {
  from: Vec3; // scaffold backbone
  to: Vec3; // staple backbone
  baseColor: string; // scaffold base at this index
  strandColor: string; // the staple's colour
}

export interface IdealHelix {
  index: number; // helix index from the data
  centre: [number, number]; // (y, z) lattice position
  scaffold: HelixStrand; // over the index range covered by this helix's staples
  lengthNm: number;
}

export interface IdealHelixModel {
  kind: "ideal-helix";
  lattice: Lattice;
  helices: IdealHelix[];
  staples: IdealStaple[];
  rungs: Rung[];
  extent: number; // bounding radius, for camera placement
  halfLengthNm: number; // half the axial length of the bundle (x)
  radiusNm: number; // bundle radius in the y–z plane, incl. backbone
  stapleCount: number;
  placedCount: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Lattice centre (y, z) of the helix with the given rank, before centring (see the file comment). */
export function latticePosition(rank: number, helixCount: number, lattice: Lattice): [number, number] {
  const S = HELIX_SPACING_NM;
  if (lattice === "single-row") return [rank * S, 0];
  const columns = Math.max(1, Math.ceil(Math.sqrt(helixCount)));
  const row = Math.floor(rank / columns);
  const col = rank % columns;
  if (lattice === "square") return [col * S, row * S];
  return [col * S * (Math.sqrt(3) / 2), row * 1.5 * S + ((row + col) % 2 === 1 ? S / 2 : 0)];
}

/** Map of helix index → centred lattice position for a set of helix indices. */
export function latticeLayout(indices: number[], lattice: Lattice): Map<number, [number, number]> {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const raw = sorted.map((_, k) => latticePosition(k, sorted.length, lattice));
  const cy = raw.length ? (Math.min(...raw.map((p) => p[0])) + Math.max(...raw.map((p) => p[0]))) / 2 : 0;
  const cz = raw.length ? (Math.min(...raw.map((p) => p[1])) + Math.max(...raw.map((p) => p[1]))) / 2 : 0;
  return new Map(sorted.map((h, k) => [h, [raw[k]![0] - cy, raw[k]![1] - cz]]));
}

/** Backbone point of base position `i` on a helix; `offsetDeg` = 0 for the scaffold, MINOR_GROOVE_DEG for staples. */
export function backbonePoint(i: number, centreIndex: number, centre: [number, number], offsetDeg: number): Vec3 {
  const theta = rad(i * TWIST_DEG + offsetDeg);
  return [(i - centreIndex) * RISE_NM, centre[0] + BACKBONE_RADIUS_NM * Math.cos(theta), centre[1] + BACKBONE_RADIUS_NM * Math.sin(theta)];
}

function strand(from: number, to: number, centreIndex: number, centre: [number, number], offsetDeg: number): HelixStrand {
  const points: Vec3[] = [];
  for (let i = from; i <= to; i++) points.push(backbonePoint(i, centreIndex, centre, offsetDeg));
  return { points, start: from, end: to, lengthNm: (to - from + 1) * RISE_NM };
}

type SelectedVariants = OptimizationResult["selected_variants"];

/**
 * Build the idealized model. Returns null when no staple has helix, start and end (nothing can be placed).
 * Variant status follows the schematic: with a result, staples the GA changed are "selected-variant",
 * staples it kept are "original", staples it could not change are "not-optimized"; without a result all
 * placed staples are "original".
 */
export function buildIdealHelix(design: DesignOut, lattice: Lattice = "honeycomb", selected?: SelectedVariants): IdealHelixModel | null {
  const chosen = new Map((selected ?? []).map((v) => [v.staple_id, v]));
  const placed = design.staples.filter((s) => s.helix != null && s.start != null && s.end != null && s.end >= s.start);
  if (placed.length === 0) return null;

  const layout = latticeLayout(
    placed.map((s) => s.helix!),
    lattice,
  );
  const minIndex = Math.min(...placed.map((s) => s.start!));
  const maxIndex = Math.max(...placed.map((s) => s.end!));
  const centreIndex = (minIndex + maxIndex) / 2;
  const scaffoldSeq = design.scaffold?.sequence.toUpperCase() ?? "";

  const helices: IdealHelix[] = [...layout.entries()].map(([index, centre]) => {
    const own = placed.filter((s) => s.helix === index);
    const from = Math.min(...own.map((s) => s.start!));
    const to = Math.max(...own.map((s) => s.end!));
    const scaffold = strand(from, to, centreIndex, centre, 0);
    return { index, centre, scaffold, lengthNm: scaffold.lengthNm };
  });

  const staples: IdealStaple[] = [];
  const rungs: Rung[] = [];
  for (const s of placed) {
    const centre = layout.get(s.helix!)!;
    const sel = chosen.get(s.id);
    const variant: BarVariant = sel ? (sel.is_original ? "original" : "selected-variant") : selected ? "not-optimized" : "original";
    const color = HELIX_COLORS[variant];
    const st = strand(s.start!, s.end!, centreIndex, centre, MINOR_GROOVE_DEG);
    staples.push({ ...st, id: s.id, helix: s.helix!, variant, color, choice: sel?.choice });
    for (let i = s.start!; i <= s.end!; i++) {
      rungs.push({
        from: backbonePoint(i, centreIndex, centre, 0),
        to: st.points[i - s.start!]!,
        baseColor: BASE_COLORS[scaffoldSeq[i] ?? ""] ?? UNKNOWN_BASE_COLOR,
        strandColor: color,
      });
    }
  }

  const halfLength = ((maxIndex - minIndex + 1) * RISE_NM) / 2;
  const radial = Math.max(...helices.map((h) => Math.hypot(h.centre[0], h.centre[1]))) + BACKBONE_RADIUS_NM;
  return {
    kind: "ideal-helix",
    lattice,
    helices,
    staples,
    rungs,
    extent: Math.hypot(halfLength, radial),
    halfLengthNm: halfLength,
    radiusNm: radial,
    stapleCount: design.staples.length,
    placedCount: placed.length,
  };
}

/** Plain-language GA status of one staple for the picking panel. */
export function gaStatus(staple: Pick<IdealStaple, "variant" | "choice">, hasResult: boolean): string {
  if (!hasResult) return "no optimization result loaded";
  if (staple.variant === "not-optimized") return "not optimized (no supplied variants)";
  if (staple.variant === "selected-variant") return `GA chose supplied variant ${staple.choice}`;
  return "GA kept the original sequence";
}
