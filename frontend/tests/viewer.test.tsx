import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DesignOut, MolecularGeometry } from "../src/api/client";
import { buildIndexSchematic, type IndexSchematic } from "../src/features/viewer/geometry";
import type { IdealHelixModel } from "../src/features/viewer/idealHelix";
import { dataset, json, renderApp } from "./utils";

// jsdom has no WebGL: replace the Three.js scene with a stand-in that reports what it was given.
const mocks = vi.hoisted(() => ({ reset: vi.fn(), zoom: vi.fn(), fail: false }));
vi.mock("../src/features/viewer/Scene3D", () => ({
  Scene3D: forwardRef<unknown, { geometry: IndexSchematic }>(function FakeScene({ geometry }, ref) {
    useImperativeHandle(ref, () => ({ reset: mocks.reset, zoom: mocks.zoom }));
    if (mocks.fail) throw new Error("WebGL context could not be created");
    const count = (v: string) => geometry.bars.filter((b) => b.variant === v).length;
    return (
      <div data-testid="scene">
        lanes={geometry.lanes.length} original={count("original")} selected={count("selected-variant")} fixed=
        {count("not-optimized")}
      </div>
    );
  }),
}));

vi.mock("../src/features/viewer/IdealHelixScene3D", () => ({
  IdealHelixScene3D: forwardRef<unknown, { model: IdealHelixModel; colorMode: string; onPick?: (s: unknown, pinned: boolean) => void }>(
    function FakeHelix({ model, colorMode, onPick }, ref) {
      useImperativeHandle(ref, () => ({ reset: mocks.reset, zoom: mocks.zoom, snapshot: () => "data:image/png;base64,AAAA" }));
      if (mocks.fail) throw new Error("WebGL context could not be created");
      return (
        <div data-testid="helix-scene">
          lattice={model.lattice} helices={model.helices.length} staples={model.staples.length} rungs={model.rungs.length} colour={colorMode}
          <button type="button" onClick={() => onPick?.(model.staples[0], true)}>
            pick first staple
          </button>
        </div>
      );
    },
  ),
}));

vi.mock("../src/features/viewer/MolecularScene3D", () => ({
  MolecularScene3D: forwardRef<unknown, { geometry: MolecularGeometry }>(function FakeMolecular({ geometry }, ref) {
    useImperativeHandle(ref, () => ({ reset: mocks.reset, zoom: mocks.zoom }));
    const roles = geometry.strands.map((st) => (st.variant && !st.variant.is_original ? "variant" : st.role)).join(",");
    return <div data-testid="molecular-scene">nucleotides={geometry.nucleotides} strands={roles}</div>;
  }),
}));

const strand = (id: string, helix: number | null, start: number | null, end: number | null, candidates: string[] = []) => ({
  id,
  sequence: "ACGTACGT",
  helix,
  start,
  end,
  candidates,
});
const design = (over: Partial<DesignOut> = {}): DesignOut =>
  ({
    id: "des1",
    dataset_id: dataset.id,
    external_id: "synthetic_00000",
    name: "Synthetic design 0",
    scaffold: strand("scaf", null, null, null),
    staples: [strand("s0000", 0, 0, 31, ["ACGTACGA"]), strand("s0001", 1, 32, 63), strand("s0003", 1, 64, 95, ["CCGTACGT"])],
    metadata: { source: "synthetic" },
    measurements: [],
    ...over,
  }) as DesignOut;
const selected = [
  { staple_id: "s0000", choice: 1, is_original: false, sequence: "ACGTACGA" },
  { staple_id: "s0003", choice: 0, is_original: true, sequence: "ACGTACGT" },
];

function serve(routes: Record<string, () => Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const route = routes[path];
    if (!route) throw new Error(`Unexpected fetch ${path}`);
    return route();
  });
}
const page = (items: unknown[]) => json(200, { items, next_cursor: null });

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("origami.apiToken", "oe_test");
  mocks.reset.mockClear();
  mocks.zoom.mockClear();
  mocks.fail = false;
});

describe("3D viewer", () => {
  it("builds the index-space schematic only from supplied helix/start/end values", () => {
    const g = buildIndexSchematic(design(), selected)!;
    expect(g.kind).toBe("index-schematic");
    expect(g.lanes).toEqual([0, 1]);
    expect([g.minIndex, g.maxIndex, g.placedCount, g.stapleCount]).toEqual([0, 95, 3, 3]);
    expect(g.bars.map((b) => [b.stapleId, b.variant])).toEqual([
      ["s0000", "selected-variant"],
      ["s0001", "not-optimized"],
      ["s0003", "original"],
    ]);
    const partial = buildIndexSchematic(design({ staples: [strand("a", 2, 0, 9), strand("b", null, 10, 19)] }))!;
    expect([partial.placedCount, partial.stapleCount]).toEqual([1, 2]); // unpositioned staples are skipped, not guessed
    expect(buildIndexSchematic(design({ staples: [strand("a", null, null, null)] }))).toBeNull();
  });

  it("selects a dataset design and shows it with its metadata and the schematic label", async () => {
    serve({
      "/api/v1/structures": () => page([]),
      "/api/v1/datasets": () => page([dataset]),
      [`/api/v1/datasets/${dataset.id}/designs`]: () =>
        page([{ id: "des1", external_id: "synthetic_00000", name: null, has_scaffold: true, scaffold_length: 256, staple_count: 3, candidate_count: 2, measurement_names: [] }]),
      "/api/v1/designs/des1": () => json(200, design()),
    });
    renderApp("/viewer");

    await screen.findByRole("option", { name: dataset.name });
    await userEvent.selectOptions(screen.getByLabelText("Dataset"), dataset.id);
    await screen.findByRole("option", { name: "synthetic_00000" });
    await userEvent.selectOptions(screen.getByLabelText("Design"), "des1");

    // The idealized helix model is the default for designs; the schematic is one click away.
    expect(await screen.findByTestId("helix-scene")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Schematic (index space)" }));
    expect(await screen.findByTestId("scene")).toHaveTextContent("lanes=2 original=3 selected=0 fixed=0");
    expect(screen.getByText(/Index-space schematic, not a molecular structure/)).toBeInTheDocument();
    const info = screen.getByRole("complementary", { name: "Design" });
    expect(within(info).getByText("synthetic_00000")).toBeInTheDocument();
    expect(within(info).getByText("3 of 3 staples")).toBeInTheDocument();
    expect(within(info).getByText("synthetic")).toBeInTheDocument(); // metadata value
    expect(screen.getByText(/3D molecular coordinates/)).toBeInTheDocument(); // listed as missing
  });

  it("shows a completed job with the optimizer's selected variants highlighted", async () => {
    serve({
      "/api/v1/structures": () => page([]),
      "/api/v1/batches": () => page([]),
      "/api/v1/jobs/j1": () =>
        json(200, { id: "j1", type: "optimize", status: "completed", design_id: "des1", attempt: 1, updated_at: "2026-10-10T10:00:00Z" }),
      "/api/v1/jobs/j1/result": () =>
        json(200, {
          design_id: "synthetic_00000",
          best_genome: [1, 0],
          best_fitness: -0.08203125,
          best_components: {},
          fitness_history: [],
          stopped_early: false,
          selected_variants: selected,
          parameters: {},
          fitness_function: { name: "synthetic_gc_balance_demo", version: "1.0.0", kind: "computational_proxy" },
        }),
      "/api/v1/designs/des1": () => json(200, design()),
    });
    renderApp("/viewer?job=j1");

    await screen.findByTestId("helix-scene");
    await userEvent.click(screen.getByRole("radio", { name: "Schematic (index space)" }));
    expect(await screen.findByTestId("scene")).toHaveTextContent("lanes=2 original=1 selected=1 fixed=1");
    const info = screen.getByRole("complementary", { name: "Design" });
    expect(await within(info).findByText(/1 of 2 optimizable staples use a supplied variant/)).toBeInTheDocument();
    expect(within(info).getByText("s0000: variant 1")).toBeInTheDocument();
    expect(within(info).getByText(/not evidence of a validated structure/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Legend" })).toHaveTextContent("optimizer chose a supplied variant");
  });

  it("explains missing structural data instead of drawing anything", async () => {
    serve({
      "/api/v1/structures": () => page([]),
      "/api/v1/datasets": () => page([dataset]),
      "/api/v1/designs/des1": () => json(200, design({ staples: [strand("s1", null, null, null, ["ACGA"])] })),
    });
    renderApp("/viewer?design=des1");

    expect(await screen.findByText("No structural data to draw for this design.")).toBeInTheDocument();
    expect(screen.queryByTestId("scene")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset view" })).not.toBeInTheDocument();
    expect(screen.getByText(/Scaffold routing/)).toBeInTheDocument();
    expect(screen.getByText(/Crossover connections/)).toBeInTheDocument();
  });

  it("wires camera controls and reports API and rendering errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    serve({
      "/api/v1/structures": () => page([]),
      "/api/v1/datasets": () => page([dataset]),
      "/api/v1/designs/des1": () => json(200, design()),
      "/api/v1/designs/missing": () => json(404, { type: "about:blank", title: "Not Found", status: 404, detail: "Design not found" }),
    });
    const view = renderApp("/viewer?design=des1");
    await screen.findByTestId("helix-scene");
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(mocks.zoom.mock.calls).toEqual([[1.25], [0.8]]);
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    view.unmount();

    const notFound = renderApp("/viewer?design=missing");
    expect(await screen.findByRole("alert")).toHaveTextContent("Design not found");
    notFound.unmount();

    mocks.fail = true;
    renderApp("/viewer?design=des1");
    expect(await screen.findByRole("alert")).toHaveTextContent(/3D rendering is unavailable.*WebGL context could not be created/);
  });
});

const structure = (over: Record<string, unknown> = {}) => ({
  id: "st1",
  name: "Two-helix oxDNA",
  format: "oxdna",
  design_id: "des1",
  status: "ready",
  has_coordinates: true,
  summary: { nucleotides: 6, strands: 2, extent: [10, 2, 0], circular_strands: 0 },
  issues: [],
  mapping: { status: "verified", scaffold_strand: 0, staples: { s0000: 1 }, unmatched: [], ambiguous: [] },
  conversion: null,
  origin: "imported",
  parent_id: null,
  simulation: null,
  created_at: "2026-10-10T10:00:00Z",
  updated_at: "2026-10-10T10:00:00Z",
  ...over,
});
const molecular = (variant: unknown = null) => ({
  kind: "molecular",
  source: "oxdna",
  length_unit_nm: 0.8518,
  nucleotides: 6,
  positions: Array.from({ length: 18 }, (_, i) => i / 10),
  strands: [
    { index: 0, offset: 0, length: 4, circular: false, role: "scaffold", design_strand_id: null, variant: null },
    { index: 1, offset: 4, length: 2, circular: false, role: "staple", design_strand_id: "s0000", variant },
  ],
  ...(variant ? { annotated_job_id: "j1" } : {}),
});

describe("3D viewer: molecular mode", () => {
  it("renders stored oxDNA coordinates for a linked structure and can switch back to the schematic", async () => {
    serve({
      "/api/v1/designs/des1": () => json(200, design()),
      "/api/v1/structures": () => page([structure()]),
      "/api/v1/structures/st1/geometry": () => json(200, molecular()),
    });
    renderApp("/viewer?design=des1");

    expect(await screen.findByTestId("molecular-scene")).toHaveTextContent("nucleotides=6 strands=scaffold,staple");
    expect(screen.getByText(/Molecular coordinates from an oxDNA file, shown as stored/)).toBeInTheDocument();
    expect(screen.getByText(/Imported: coordinates as stored in the uploaded oxDNA files/)).toBeInTheDocument();
    expect(screen.queryByText(/Not a molecular structure/)).not.toBeInTheDocument();
    const info = screen.getByRole("complementary", { name: "Structure" });
    expect(within(info).getByText("verified")).toBeInTheDocument();
    expect(within(info).getByText("8.5 × 1.7 × 0.0 nm")).toBeInTheDocument();
    expect(screen.queryByTestId("scene")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Schematic (index space)" }));
    expect(await screen.findByTestId("scene")).toBeInTheDocument();
    expect(screen.queryByTestId("molecular-scene")).not.toBeInTheDocument();
    expect(screen.getByText(/Index-space schematic, not a molecular structure/)).toBeInTheDocument();
  });

  it("falls back to the idealized model (and the schematic) and explains why when a structure has no usable coordinates", async () => {
    serve({
      "/api/v1/designs/des1": () => json(200, design()),
      "/api/v1/structures": () =>
        page([
          structure({
            status: "invalid",
            has_coordinates: false,
            issues: [{ code: "E_CONF_ORIENTATION", message: "a1 must be a unit vector", severity: "error", location: "configuration line 4" }],
          }),
        ]),
    });
    renderApp("/viewer?design=des1");

    const banner = await screen.findByText(/failed validation, so no coordinates are shown/);
    expect(banner.closest("[role=status]")).toHaveTextContent("E_CONF_ORIENTATION a1 must be a unit vector (configuration line 4)");
    expect(await screen.findByTestId("helix-scene")).toBeInTheDocument(); // idealized fallback (no usable coordinates)
    expect(screen.queryByRole("radio", { name: /Molecular/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Schematic (index space)" }));
    expect(await screen.findByTestId("scene")).toBeInTheDocument(); // schematic still available
  });

  it("annotates verified staples with a completed job's variants without claiming folding", async () => {
    const spy = serve({
      "/api/v1/batches": () => page([]),
      "/api/v1/jobs/j1": () =>
        json(200, { id: "j1", type: "optimize", status: "completed", design_id: "des1", attempt: 1, updated_at: "2026-10-10T10:00:00Z" }),
      "/api/v1/jobs/j1/result": () =>
        json(200, { design_id: "synthetic_00000", best_genome: [1, 0], best_fitness: -0.08, best_components: {}, fitness_history: [],
          stopped_early: false, selected_variants: selected, parameters: {},
          fitness_function: { name: "synthetic_gc_balance_demo", version: "1.0.0", kind: "computational_proxy" } }),
      "/api/v1/designs/des1": () => json(200, design()),
      "/api/v1/structures": () => page([structure()]),
      "/api/v1/structures/st1/geometry": () => json(200, molecular({ choice: 1, is_original: false, length_compatible: true })),
    });
    renderApp("/viewer?job=j1");

    expect(await screen.findByTestId("molecular-scene")).toHaveTextContent("strands=scaffold,variant");
    const geometryCall = spy.mock.calls.map(([u]) => String(u)).find((u) => u.includes("/geometry"));
    expect(geometryCall).toContain("job_id=j1");
    const info = screen.getByRole("complementary", { name: "Structure" });
    expect(within(info).getByText(/use a supplied variant/)).toBeInTheDocument();
    expect(within(info).getByText(/variants are annotations only.*does not show that this structure, or the variant design, folds/)).toBeInTheDocument();
  });
});

describe("3D viewer: structure origin", () => {
  it("labels simulated structures and flags placeholder (straight-line) coordinates", async () => {
    serve({
      "/api/v1/designs/des1": () => json(200, design()),
      "/api/v1/structures": () =>
        page([
          structure({
            origin: "simulated",
            parent_id: "st0",
            simulation: { program: "oxDNA", protocol: "relax", steps: 500 },
            issues: [{ code: "W_NONHELICAL_GEOMETRY", message: "Every strand is a straight line", severity: "warning", location: null }],
          }),
        ]),
      "/api/v1/structures/st1/geometry": () => json(200, molecular()),
    });
    renderApp("/viewer?design=des1");

    await screen.findByTestId("molecular-scene");
    expect(screen.getByText(/Simulated with oxDNA: relax protocol, 500 steps/)).toBeInTheDocument();
    expect(screen.getAllByRole("alert").some((a) => /Not a molecular structure/.test(a.textContent ?? ""))).toBe(true);
    expect(screen.queryByText(/prediction/i)).not.toBeInTheDocument();
  });
});

describe("3D viewer: idealized helix model", () => {
  const routes = (over: Record<string, () => Response> = {}) => ({
    "/api/v1/structures": () => page([]),
    "/api/v1/datasets": () => page([dataset]),
    "/api/v1/designs/des1": () => json(200, design()),
    ...over,
  });

  it("is the default for designs, labels itself honestly and switches modes", async () => {
    serve(routes());
    renderApp("/viewer?design=des1");

    expect(await screen.findByTestId("helix-scene")).toHaveTextContent("lattice=honeycomb helices=2 staples=3 rungs=96 colour=base");
    expect(
      screen.getByText(
        "Idealized B-DNA model generated from helix/start/end and the lattice you chose. Not a molecular structure: helix arrangement, crossovers and scaffold routing are not in the data.",
      ),
    ).toBeInTheDocument();
    const modes = screen.getByRole("radiogroup", { name: "View mode" });
    expect(within(modes).getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual([
      "Idealized helix model",
      "Schematic (index space)",
    ]);
    expect(screen.getByRole("radio", { name: "Idealized helix model" })).toBeChecked();
    expect(screen.getByText(/Crossover connections/)).toBeInTheDocument(); // still listed as missing

    await userEvent.click(screen.getByRole("radio", { name: "Schematic (index space)" }));
    expect(await screen.findByTestId("scene")).toBeInTheDocument();
    expect(screen.queryByTestId("helix-scene")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Idealized helix model" }));
    expect(await screen.findByTestId("helix-scene")).toBeInTheDocument();
  });

  it("changes lattice and colour mode, updates the legend and exports a PNG", async () => {
    serve(routes());
    renderApp("/viewer?design=des1");
    const scene = await screen.findByTestId("helix-scene");

    const legend = screen.getByRole("list", { name: "Legend" });
    expect(legend).toHaveTextContent("scaffold");
    expect(legend).toHaveTextContent("base pairs by scaffold base:");
    for (const base of ["A", "T", "G", "C"]) expect(within(legend).getByText(base)).toBeInTheDocument();
    expect(legend).toHaveTextContent("crossovers and scaffold routing: not drawn (not in the data)");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Lattice" }), "square");
    expect(scene).toHaveTextContent("lattice=square");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Lattice" }), "single-row");
    expect(scene).toHaveTextContent("lattice=single-row");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Colour mode" }), "strand");
    expect(scene).toHaveTextContent("colour=strand");
    expect(legend).toHaveTextContent("base pairs coloured by staple");

    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await userEvent.click(screen.getByRole("button", { name: "Download PNG" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0]).toHaveAttribute("download", "synthetic_00000-ideal-helix-single-row.png");

    await userEvent.click(screen.getByRole("button", { name: "Auto-rotate" }));
    expect(screen.getByRole("button", { name: "Stop auto-rotate" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a picked staple's position, length and GA decision", async () => {
    serve(
      routes({
        "/api/v1/batches": () => page([]),
        "/api/v1/jobs/j1": () => json(200, { id: "j1", type: "optimize", status: "completed", design_id: "des1", attempt: 1, updated_at: "2026-10-10T10:00:00Z" }),
        "/api/v1/jobs/j1/result": () =>
          json(200, {
            design_id: "synthetic_00000",
            best_genome: [1, 0],
            best_fitness: -0.08203125,
            best_components: {},
            fitness_history: [],
            stopped_early: false,
            selected_variants: selected,
            parameters: {},
            fitness_function: { name: "synthetic_gc_balance_demo", version: "1.0.0", kind: "computational_proxy" },
          }),
      }),
    );
    renderApp("/viewer?job=j1");
    await screen.findByTestId("helix-scene");
    await screen.findByText("staple: GA chose a supplied variant");
    await userEvent.click(screen.getByRole("button", { name: "pick first staple" }));

    const card = screen.getByRole("group", { name: "Selected staple" });
    expect(card).toHaveTextContent("s0000");
    expect(card).toHaveTextContent("Helix0");
    expect(card).toHaveTextContent("Start–end0–31");
    expect(card).toHaveTextContent("32 nt (10.88 nm)");
    expect(card).toHaveTextContent("GA chose supplied variant 1");
    await userEvent.click(within(card).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("group", { name: "Selected staple" })).not.toBeInTheDocument();
  });
});
