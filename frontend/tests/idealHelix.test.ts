import { describe, expect, it } from "vitest";

import type { DesignOut } from "../src/api/client";
import {
  BACKBONE_RADIUS_NM,
  BASE_COLORS,
  buildIdealHelix,
  HELIX_COLORS,
  HELIX_SPACING_NM,
  latticeLayout,
  latticePosition,
  MINOR_GROOVE_DEG,
  RISE_NM,
  TWIST_DEG,
  type Lattice,
} from "../src/features/viewer/idealHelix";

const strand = (id: string, helix: number | null, start: number | null, end: number | null, candidates: string[] = []) => ({
  id,
  sequence: "A".repeat(start !== null && end !== null ? end - start + 1 : 4),
  helix,
  start,
  end,
  candidates,
});
const SCAFFOLD = "ACGT".repeat(40); // index i -> "ACGT"[i % 4]
const design = (staples = [strand("s0", 0, 0, 15, ["X"]), strand("s1", 1, 16, 31), strand("s2", 1, 32, 47, ["Y"])]): DesignOut =>
  ({
    id: "d",
    dataset_id: "ds",
    external_id: "tile",
    name: null,
    scaffold: { id: "scaf", sequence: SCAFFOLD, helix: null, start: null, end: null, candidates: [] },
    staples,
    metadata: {},
    measurements: [],
  }) as unknown as DesignOut;

const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));

describe("idealized B-DNA geometry", () => {
  it("uses textbook B-DNA constants", () => {
    expect(RISE_NM).toBe(0.34);
    expect(TWIST_DEG).toBeCloseTo(34.29, 2);
    expect(BACKBONE_RADIUS_NM).toBe(1);
    expect(MINOR_GROOVE_DEG).toBe(144);
    expect(HELIX_SPACING_NM).toBe(2.25);
  });

  it("gives each strand a length of (end − start + 1) × 0.34 nm and a 34.29° twist per base pair", () => {
    const m = buildIdealHelix(design())!;
    const s0 = m.staples.find((s) => s.id === "s0")!;
    expect(s0.lengthNm).toBeCloseTo(16 * 0.34, 10);
    expect(s0.points).toHaveLength(16);
    // Consecutive bases advance 0.34 nm along the axis (x) ...
    expect(s0.points[1]![0] - s0.points[0]![0]).toBeCloseTo(0.34, 10);
    // ... and rotate 34.29° around it, at 1.0 nm from the helix centre.
    const h0 = m.helices.find((h) => h.index === 0)!;
    const angle = (p: number[]) => Math.atan2(p[2]! - h0.centre[1], p[1]! - h0.centre[0]);
    const step = (((angle(s0.points[1]!) - angle(s0.points[0]!)) * 180) / Math.PI + 360) % 360;
    expect(step).toBeCloseTo(34.2857, 3);
    expect(Math.hypot(s0.points[0]![1] - h0.centre[0], s0.points[0]![2] - h0.centre[1])).toBeCloseTo(1, 10);
    // Helix 1 is covered from 16 to 47: its scaffold spans 32 bp.
    expect(m.helices.find((h) => h.index === 1)!.lengthNm).toBeCloseTo(32 * 0.34, 10);
  });

  it("places distinct helix indices at distinct, deterministic lattice positions", () => {
    const indices = [7, 0, 3, 12, 5, 9, 1];
    for (const lattice of ["honeycomb", "square", "single-row"] as Lattice[]) {
      const a = latticeLayout(indices, lattice);
      const b = latticeLayout([...indices].reverse(), lattice);
      expect([...a.entries()]).toEqual([...b.entries()]); // independent of input order
      const keys = new Set([...a.values()].map((p) => p.map((v) => v.toFixed(6)).join(",")));
      expect(keys.size).toBe(indices.length);
      const pts = [...a.values()];
      const nearest = Math.min(...pts.flatMap((p, i) => pts.slice(i + 1).map((q) => dist(p, q))));
      expect(nearest).toBeCloseTo(HELIX_SPACING_NM, 6); // neighbours exactly one spacing apart, none closer
    }
    expect(latticePosition(2, 1, "single-row")).toEqual([2 * HELIX_SPACING_NM, 0]);
  });

  it("has one rung per staple position, coloured by the scaffold base or by strand", () => {
    const m = buildIdealHelix(design())!;
    expect(m.rungs).toHaveLength(16 + 16 + 16); // total staple length
    // Staple s0 covers scaffold 0..15; rung k pairs with scaffold base SCAFFOLD[k].
    expect(m.rungs.slice(0, 4).map((r) => r.baseColor)).toEqual(["A", "C", "G", "T"].map((b) => BASE_COLORS[b]));
    expect(dist(m.rungs[0]!.from, m.rungs[0]!.to)).toBeGreaterThan(0);
    expect(m.rungs[0]!.strandColor).toBe(m.staples[0]!.color);
  });

  it("colours staples by variant status, and skips staples without positions", () => {
    const noResult = buildIdealHelix(design())!;
    expect(new Set(noResult.staples.map((s) => s.color))).toEqual(new Set([HELIX_COLORS.original]));

    const withResult = buildIdealHelix(design(), "honeycomb", [
      { staple_id: "s0", choice: 1, is_original: false, sequence: "X" },
      { staple_id: "s2", choice: 0, is_original: true, sequence: "A" },
    ])!;
    const by = Object.fromEntries(withResult.staples.map((s) => [s.id, s]));
    expect(by.s0!.color).toBe(HELIX_COLORS["selected-variant"]);
    expect(by.s0!.choice).toBe(1);
    expect(by.s1!.color).toBe(HELIX_COLORS["not-optimized"]);
    expect(by.s2!.color).toBe(HELIX_COLORS.original);

    const partial = buildIdealHelix(design([strand("a", 0, 0, 9), strand("b", null, null, null)]))!;
    expect(partial.placedCount).toBe(1);
    expect(partial.stapleCount).toBe(2);
    expect(buildIdealHelix(design([strand("b", null, null, null)]))).toBeNull();
  });
});
