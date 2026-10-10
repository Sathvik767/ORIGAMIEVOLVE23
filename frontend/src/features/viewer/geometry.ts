/**
 * Viewer geometry: what the 3D viewer may draw, derived only from fields that exist in the data.
 *
 * Supported today — "index-space schematic" (kind: "index-schematic"):
 *   - Source: staple `helix`, `start`, `end` (CSV columns / JSON fields; see docs/input-formats.md).
 *   - Mapping: one lane per distinct helix index; one bar per staple spanning start..end along the lane.
 *     x = nucleotide index (as given), lane order = helix index order. Lane spacing is a display
 *     constant, NOT a physical distance or lattice.
 *   - Not drawn because the data does not contain it: molecular/3D coordinates, helix lattice
 *     arrangement, scaffold routing, crossover connections. Nothing is inferred to fill these in.
 *
 * Not yet supported — molecular coordinates: the ingestion schema currently rejects a `geometry`
 * field (planned with backend support), so no dataset can carry real coordinates yet.
 */

import type { DesignOut, OptimizationResult } from "../../api/client";

export type BarVariant = "original" | "selected-variant" | "not-optimized";

export interface SchematicBar {
  stapleId: string;
  helix: number;
  start: number;
  end: number;
  variant: BarVariant;
}

export interface IndexSchematic {
  kind: "index-schematic";
  lanes: number[]; // distinct helix indices, ascending
  bars: SchematicBar[];
  minIndex: number;
  maxIndex: number;
  stapleCount: number;
  placedCount: number; // staples with helix + start + end
}

export const MISSING_STRUCTURE = [
  "3D molecular coordinates (no coordinate data is stored for designs)",
  "Scaffold routing (the scaffold has a sequence but no path through the helices)",
  "Crossover connections (not present in the input schema)",
  "Helix lattice arrangement (helix indices only, no spatial positions)",
] as const;

type SelectedVariants = OptimizationResult["selected_variants"];

export function buildIndexSchematic(design: DesignOut, selected?: SelectedVariants): IndexSchematic | null {
  const choice = new Map((selected ?? []).map((v) => [v.staple_id, v.is_original ? "original" : "selected-variant"]));
  const bars: SchematicBar[] = [];
  for (const s of design.staples) {
    if (s.helix == null || s.start == null || s.end == null) continue;
    bars.push({
      stapleId: s.id,
      helix: s.helix,
      start: s.start,
      end: s.end,
      variant: (choice.get(s.id) as BarVariant | undefined) ?? (selected ? "not-optimized" : "original"),
    });
  }
  if (bars.length === 0) return null;
  return {
    kind: "index-schematic",
    lanes: [...new Set(bars.map((b) => b.helix))].sort((a, b) => a - b),
    bars,
    minIndex: Math.min(...bars.map((b) => b.start)),
    maxIndex: Math.max(...bars.map((b) => b.end)),
    stapleCount: design.staples.length,
    placedCount: bars.length,
  };
}
