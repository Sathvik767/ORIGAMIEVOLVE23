import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dataset, json, renderApp } from "./utils";

type Handler = (method: string, path: string, url: URL, init: RequestInit) => Response | Promise<Response>;

function serve(handler: Handler) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input), "http://localhost");
    return handler(init.method ?? "GET", url.pathname, url, init);
  });
}

const page = (items: unknown[], next_cursor: string | null = null) => json(200, { items, next_cursor });
const DEMO = "synthetic_gc_balance_demo";
const PAIRING = "staple_scaffold_complementarity";
const OBJECTIVES = [DEMO, PAIRING].map((name) => ({
  name,
  version: "1.0.0",
  kind: "computational_proxy",
  description: `${name} description.`,
  limitations: "Computational proxy only.",
  requires: name === DEMO ? "design metadata.source == 'synthetic'" : "scaffold sequence",
}));
const design = (id: string, candidate_count = 2) => ({
  id,
  external_id: `lab_${id}`,
  name: null,
  has_scaffold: true,
  scaffold_length: 64,
  staple_count: 4,
  candidate_count,
  measurement_names: [],
});
const NOT_SYNTHETIC = "synthetic_gc_balance_demo is a demonstration for synthetic data only";

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("origami.apiToken", "oe_test");
});
afterEach(() => vi.unstubAllGlobals());

describe("batch creation", () => {
  function batchApi(opts: { nextPage?: boolean } = {}) {
    const designs = [design("d1"), design("d2")];
    return serve((method, path, url) => {
      if (path === "/api/v1/datasets") return page([dataset]);
      if (path === "/api/v1/batches" && method === "GET") return page([]);
      if (path === "/api/v1/fitness-functions") return json(200, OBJECTIVES);
      if (path === `/api/v1/datasets/${dataset.id}/designs`) return page(designs, opts.nextPage ? "cursor-2" : null);
      if (path === `/api/v1/datasets/${dataset.id}/compatibility`) {
        // The demo objective refuses these (non-synthetic) designs; the pairing objective accepts them.
        const demo = url.searchParams.get("fitness") === DEMO;
        return page(
          designs.map((d) => ({
            design_id: d.id,
            external_id: d.external_id,
            compatible: !demo,
            reason: demo ? `${NOT_SYNTHETIC}; design '${d.external_id}' is not marked metadata.source == 'synthetic'.` : null,
          })),
          opts.nextPage ? "cursor-2" : null,
        );
      }
      if (path === "/api/v1/batches" && method === "POST")
        return json(202, { id: "b1", name: null, dataset_id: dataset.id, status: "queued", counts: {}, total_jobs: 2, params: {}, fitness: { name: PAIRING, version: "1", kind: "computational_proxy" }, method: "auto", created_at: "2026-10-27T10:00:00Z", updated_at: "2026-10-27T10:00:00Z" });
      throw new Error(`Unexpected ${method} ${path}`);
    });
  }

  it("disables designs the objective cannot score, with the reason, and explains the demo objective", async () => {
    batchApi();
    renderApp("/batches");
    await screen.findByRole("option", { name: /Batch A/ });
    await userEvent.selectOptions(screen.getByLabelText("Validated dataset"), dataset.id);

    const row = (await screen.findByText("lab_d1")).closest("label")!;
    await waitFor(() => expect(within(row).getByText(new RegExp(NOT_SYNTHETIC))).toBeInTheDocument());
    expect(within(row).getByRole("checkbox")).toBeDisabled();
    expect(screen.getByLabelText(/Select all valid designs/)).toBeDisabled();
    expect(screen.getByText(/default demo objective cannot be used on this dataset/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start batch (0 jobs)" })).toBeDisabled();

    // An objective that can score them enables the designs and removes the notice.
    await userEvent.selectOptions(screen.getByLabelText("Objective (fitness function)"), PAIRING);
    await waitFor(() => expect(within(row).getByRole("checkbox")).toBeEnabled());
    expect(within(row).getByText("2 variants")).toBeInTheDocument();
    expect(screen.queryByText(/default demo objective cannot be used/)).not.toBeInTheDocument();
  });

  it("sends the method and advanced GA settings, and 'all designs in dataset' omits design_ids", async () => {
    const spy = batchApi({ nextPage: true });
    renderApp("/batches");
    await screen.findByRole("option", { name: /Batch A/ });
    await userEvent.selectOptions(screen.getByLabelText("Validated dataset"), dataset.id);
    await userEvent.selectOptions(await screen.findByLabelText("Objective (fitness function)"), PAIRING);
    await screen.findAllByText("2 variants");
    expect(screen.getByText(/Select all valid designs \(loaded so far\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/Select all designs in dataset \(2\)/));
    expect(screen.getByText("all designs in dataset")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Search method"), "ga");
    await userEvent.click(screen.getByText("Advanced GA settings"));
    const generations = screen.getByLabelText("Generations");
    expect(generations).toHaveValue(100);
    expect(screen.getByLabelText("Population size")).toHaveValue(50);
    await userEvent.clear(generations);
    await userEvent.type(generations, "250");
    await userEvent.click(screen.getByRole("button", { name: "Start batch (2 jobs)" }));

    await screen.findByText(/Batch queued with 2 jobs/);
    const post = spy.mock.calls.find(([, init]) => init?.method === "POST")!;
    const body = JSON.parse(String(post[1]!.body));
    expect(body).not.toHaveProperty("design_ids");
    expect(body).toMatchObject({ dataset_id: dataset.id, fitness: PAIRING, method: "ga", generations: 250, population_size: 50, mutation_rate: 0.05, crossover_rate: 0.8, elitism: 2, tournament_size: 3, seed: 42 });
  });
});

describe("demo objective display and exhaustive results", () => {
  const BATCH = "6aca0f510ad747466627f88b";
  const completedJob = {
    id: "j1",
    type: "optimize",
    status: "completed",
    batch_id: BATCH,
    dataset_id: dataset.id,
    design_id: "d1",
    external_id: "synthetic_00000",
    attempt: 1,
    cancel_requested: false,
    method: "auto",
    fitness: DEMO,
    params: { population_size: 80, generations: 100, mutation_rate: 0.05, crossover_rate: 0.8, elitism: 2, tournament_size: 3, seed: 42 },
    progress: {},
    error: null,
    result: { result_key: "k", best_fitness: -0.0625, best_components: { mean_gc_deviation: 0.0625 }, method: "exhaustive", num_genes: 3 },
    queued_at: null,
    started_at: null,
    finished_at: null,
    updated_at: "2026-10-27T10:00:00Z",
  };
  const result = {
    design_id: "synthetic_00000",
    method: "exhaustive",
    note: "Exhaustive search scored all 8 combinations; no GA generations were run.",
    best_genome: [1, 0, 1],
    best_fitness: -0.0625,
    best_components: { mean_gc_deviation: 0.0625 },
    fitness_history: [],
    stopped_early: false,
    evaluations: 8,
    unique_evaluations: 8,
    final_population_fitness: null,
    final_candidates: [
      { rank: 1, genome: [1, 0, 1], fitness: -0.0625, components: { mean_gc_deviation: 0.0625 }, occurrences: 1, selections: [{ staple_id: "s0", choice: 1, is_original: false, sequence: "ACGT" }] },
      { rank: 2, genome: [0, 0, 1], fitness: -0.09375, components: { mean_gc_deviation: 0.09375 }, occurrences: 1, selections: [{ staple_id: "s0", choice: 0, is_original: true, sequence: "AAAA" }] },
    ],
    selected_variants: [{ staple_id: "s0", choice: 1, is_original: false, sequence: "ACGT" }],
    parameters: { method: "exhaustive", search_space_size: 8, num_genes: 3 },
    fitness_function: { name: DEMO, version: "1.0.0", kind: "computational_proxy", limitations: "Demo only." },
  };

  it("labels demo scores as mean GC deviation and renders an exhaustive result without a chart", async () => {
    serve((method, path) => {
      if (path === `/api/v1/batches/${BATCH}`)
        return json(200, { id: BATCH, name: "B", dataset_id: dataset.id, status: "completed", counts: { completed: 1 }, total_jobs: 1, params: completedJob.params, fitness: { name: DEMO, version: "1.0.0", kind: "computational_proxy" }, method: "auto", created_at: "2026-10-27T10:00:00Z", updated_at: "2026-10-27T10:00:00Z", finished_at: null });
      if (path === `/api/v1/batches/${BATCH}/jobs`) return page([completedJob]);
      if (path === "/api/v1/jobs/j1/history")
        return json(200, { job_id: "j1", status: "completed", total_generations: null, source: "result", history: [], note: result.note });
      if (path === "/api/v1/jobs/j1/result") return json(200, result);
      throw new Error(`Unexpected ${method} ${path}`);
    });
    renderApp(`/batches/${BATCH}`);

    // Batch settings: method and the GA parameters actually recorded.
    const settings = await screen.findByLabelText("GA settings used");
    expect(within(settings).getByText("population size").nextSibling).toHaveTextContent("80 (custom)");
    expect(within(settings).getByText("generations").nextSibling).toHaveTextContent(/^100$/);

    const jobs = screen.getByRole("region", { name: "Jobs" });
    const row = within(jobs).getByText("synthetic_00000").closest("tr")!;
    expect(row).toHaveTextContent("exhaustive");
    expect(row).toHaveTextContent("mean GC deviation = 0.0625 (lower is better)");
    expect(row).toHaveTextContent("score -0.0625");

    const panel = await screen.findByRole("region", { name: /Analysis: synthetic_00000/ });
    expect(within(panel).getByText("Method").nextSibling).toHaveTextContent("Exhaustive search");
    expect(within(panel).getByText("Best").nextSibling).toHaveTextContent("mean GC deviation = 0.0625 (lower is better)");
    expect(within(panel).getByText("Combinations scored").nextSibling).toHaveTextContent("8");
    expect(within(panel).getByText(/no GA generations were run/)).toBeInTheDocument();
    expect(within(panel).queryByRole("img", { name: /Best and mean fitness/ })).not.toBeInTheDocument();
    expect(within(panel).getByText("Candidate ranking (all combinations)")).toBeInTheDocument();
    const top = within(panel).getByText("(selected)").closest("tr")!;
    expect(top).toHaveTextContent("mean GC deviation = 0.0625");
    expect(within(panel).getByText(/Not applicable: exhaustive search has no population/)).toBeInTheDocument();
    expect(within(panel).getByText(/not evidence that the design folds/)).toBeInTheDocument();
  });
});

class FakeXHR {
  static all: FakeXHR[] = [];
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  status = 0;
  responseText = "";
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  constructor() {
    FakeXHR.all.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

describe("structures page", () => {
  const structure = (over: Record<string, unknown>) => ({
    id: "s1",
    name: "tile",
    format: "oxdna",
    design_id: null,
    status: "ready",
    has_coordinates: true,
    summary: null,
    issues: [],
    mapping: null,
    conversion: null,
    origin: "imported",
    parent_id: null,
    simulation: null,
    created_at: "2026-10-27T10:00:00Z",
    updated_at: "2026-10-27T10:00:00Z",
    ...over,
  });
  const tools = (tacoxdna: boolean) => ({
    oxdna: { configured: false, available: false, setting: "ORIGAMI_OXDNA_BIN", message: "Not available" },
    tacoxdna: { configured: tacoxdna, available: tacoxdna, setting: "ORIGAMI_TACOXDNA_DIR", message: tacoxdna ? null : "Not available: set ORIGAMI_TACOXDNA_DIR" },
  });
  const listed = [
    structure({}),
    structure({ id: "s2", name: "hex tile", format: "cadnano", status: "topology_only", has_coordinates: false, issues: [{ code: "W_LOOPS_IGNORED", severity: "warning" }] }),
    structure({ id: "s3", name: "broken", status: "invalid", has_coordinates: false, issues: [{ code: "E_TOPOLOGY", severity: "error" }, { code: "E_TOPOLOGY", severity: "error" }] }),
  ];

  it("lists structures with status, origin, issue codes and viewer links; convert only with tacoxDNA", async () => {
    serve((method, path) => {
      if (path === "/api/v1/structures") return page(listed);
      if (path === "/api/v1/structures/tools") return json(200, tools(false));
      throw new Error(`Unexpected ${method} ${path}`);
    });
    renderApp("/structures");
    expect(await screen.findByRole("link", { name: "Structures" })).toHaveAttribute("href", "/structures");
    const table = (await screen.findByText("hex tile")).closest("table")!;
    const ready = within(table).getByText("tile").closest("tr")!;
    expect(within(ready).getByText("ready")).toBeInTheDocument();
    expect(within(ready).getByText("imported")).toBeInTheDocument();
    expect(within(ready).getByRole("link", { name: "Open in 3D viewer" })).toHaveAttribute("href", "/viewer?structure=s1");
    const cad = within(table).getByText("hex tile").closest("tr")!;
    expect(within(cad).getByText("topology only")).toBeInTheDocument();
    expect(within(cad).getByText("W_LOOPS_IGNORED")).toBeInTheDocument();
    expect(within(cad).queryByRole("button", { name: "Convert to oxDNA" })).not.toBeInTheDocument();
    expect(await screen.findByText(/conversion is unavailable/)).toBeInTheDocument();
    const broken = within(table).getByText("broken").closest("tr")!;
    expect(within(broken).getByText("E_TOPOLOGY")).toBeInTheDocument(); // codes listed once
    expect(within(broken).queryByRole("link", { name: "Open in 3D viewer" })).not.toBeInTheDocument();
  });

  it("offers Convert when tacoxDNA is available and sends the chosen lattice", async () => {
    const spy = serve((method, path) => {
      if (path === "/api/v1/structures") return page(listed);
      if (path === "/api/v1/structures/tools") return json(200, tools(true));
      if (path === "/api/v1/structures/s2/convert" && method === "POST") return json(202, structure({ id: "s2", status: "converting" }));
      throw new Error(`Unexpected ${method} ${path}`);
    });
    renderApp("/structures");
    const cad = (await screen.findByText("hex tile")).closest("tr")!;
    await userEvent.selectOptions(await within(cad).findByLabelText("Lattice for hex tile"), "honeycomb");
    await userEvent.click(within(cad).getByRole("button", { name: "Convert to oxDNA" }));
    await waitFor(() => expect(spy.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const post = spy.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(new URL(String(post[0]), "http://x").searchParams.get("lattice")).toBe("honeycomb");
  });

  it("uploads an oxDNA topology then its configuration as raw bodies", async () => {
    FakeXHR.all = [];
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    serve((method, path) => {
      if (path === "/api/v1/structures") return page([]);
      if (path === "/api/v1/structures/tools") return json(200, tools(false));
      throw new Error(`Unexpected ${method} ${path}`);
    });
    renderApp("/structures");
    const top = new File(["2 1\n1 A -1 1\n1 T 0 -1\n"], "tile.top");
    const conf = new File(["t = 0\n"], "tile.dat");
    await userEvent.upload(await screen.findByLabelText("Topology file (.top)"), top);
    await userEvent.upload(screen.getByLabelText("Configuration file (.dat / .conf)"), conf);
    expect(screen.getByLabelText("Name")).toHaveValue("tile");
    await userEvent.type(screen.getByLabelText("Linked design id (optional)"), "651f00000000000000000002");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    const first = FakeXHR.all[0]!;
    const url = new URL(first.url, "http://x");
    expect(first.method).toBe("POST");
    expect(url.pathname).toBe("/api/v1/structures");
    expect(Object.fromEntries(url.searchParams)).toEqual({ name: "tile", format: "oxdna", design_id: "651f00000000000000000002" });
    expect(first.headers["Content-Type"]).toBe("application/octet-stream");
    expect(first.headers.Authorization).toBe("Bearer oe_test");
    expect(first.body).toBe(top);
    first.respond(202, structure({ id: "new", status: "awaiting_configuration", has_coordinates: false }));

    await waitFor(() => expect(FakeXHR.all).toHaveLength(2));
    const second = FakeXHR.all[1]!;
    expect(second.method).toBe("PUT");
    expect(second.url).toBe("/api/v1/structures/new/configuration");
    expect(second.body).toBe(conf);
    second.respond(202, structure({ id: "new", status: "validating" }));
    expect(await screen.findByText(/Imported “tile”; validation is running/)).toBeInTheDocument();
  });
});
