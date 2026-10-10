import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POLL_INTERVAL_MS } from "../src/features/batches/status";
import { dataset, json, renderApp } from "./utils";

type Handler = (method: string, path: string, init: RequestInit) => Response | Promise<Response>;

/** Fetch mock routed on method + path (query string stripped). Unmatched requests fail loudly. */
function serve(handler: Handler) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input), "http://localhost");
    return handler(init.method ?? "GET", url.pathname, init);
  });
}

function calls(spy: ReturnType<typeof serve>, method: string, path: string) {
  return spy.mock.calls.filter(([input, init]) => {
    const url = new URL(String(input), "http://localhost");
    return (init?.method ?? "GET") === method && url.pathname === path;
  });
}

const BATCH_ID = "6aca0f510ad747466627f88b";
const batch = (over: Record<string, unknown> = {}) => ({
  id: BATCH_ID,
  name: "Nightly batch",
  dataset_id: dataset.id,
  status: "running",
  counts: { queued: 1, running: 1, completed: 1, failed: 0, cancelled: 0 },
  total_jobs: 3,
  params: { seed: 42 },
  fitness: { name: "synthetic_gc_balance_demo", version: "1.0.0", kind: "computational_proxy" },
  created_at: "2026-10-10T10:00:00Z",
  updated_at: "2026-10-10T10:00:05Z",
  finished_at: null,
  ...over,
});
const job = (id: string, over: Record<string, unknown>) => ({
  id,
  type: "optimize",
  status: "queued",
  batch_id: BATCH_ID,
  dataset_id: dataset.id,
  design_id: `design-${id}`,
  external_id: `synthetic_0000${id}`,
  attempt: 1,
  cancel_requested: false,
  progress: {},
  error: null,
  result: null,
  queued_at: "2026-10-10T10:00:00Z",
  started_at: null,
  finished_at: null,
  updated_at: "2026-10-10T10:00:05Z",
  ...over,
});
const page = (items: unknown[]) => json(200, { items, next_cursor: null });
const designs = [
  { id: "d1", external_id: "tile_1", name: null, has_scaffold: true, scaffold_length: 64, staple_count: 8, candidate_count: 3, measurement_names: [] },
  { id: "d2", external_id: "tile_2", name: null, has_scaffold: true, scaffold_length: 64, staple_count: 8, candidate_count: 0, measurement_names: [] },
  { id: "d3", external_id: "tile_3", name: null, has_scaffold: true, scaffold_length: 64, staple_count: 8, candidate_count: 1, measurement_names: [] },
];

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("origami.apiToken", "oe_test");
});
afterEach(() => vi.useRealTimers());

describe("batch optimization", () => {
  it("selects designs and submits the batch once with the correct payload", async () => {
    let release!: () => void;
    const spy = serve(async (method, path) => {
      if (method === "GET" && path === "/api/v1/datasets") return page([dataset]);
      if (method === "GET" && path === `/api/v1/datasets/${dataset.id}/designs`) return page(designs);
      if (method === "GET" && path === "/api/v1/batches") return page([]);
      if (method === "GET" && path === "/api/v1/fitness-functions")
        return json(200, [
          { name: "synthetic_gc_balance_demo", version: "1.0.0", kind: "computational_proxy", description: "Demo.", limitations: "Not a folding measure.", requires: "synthetic" },
          { name: "staple_scaffold_complementarity", version: "1.0.0", kind: "computational_proxy", description: "Pairing.", limitations: "Base pairing only; not a measure of folding yield.", requires: "start/end" },
        ]);
      if (method === "POST" && path === "/api/v1/batches") {
        await new Promise<void>((r) => (release = r));
        return json(202, batch({ status: "queued", total_jobs: 1 }));
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });
    renderApp("/batches");

    await screen.findByRole("option", { name: /Batch A/ });
    await userEvent.selectOptions(screen.getByLabelText("Validated dataset"), dataset.id);
    await userEvent.click(await screen.findByLabelText(/Select all valid designs/));
    expect(screen.getByRole("checkbox", { name: /tile_2/ })).toBeDisabled(); // no variants
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /tile_3/ }));
    await userEvent.type(screen.getByLabelText("Batch name (optional)"), "Nightly batch");
    const seed = screen.getByLabelText("Random seed");
    expect(seed).toHaveValue(42);
    await userEvent.clear(seed);
    await userEvent.type(seed, "7");
    await userEvent.selectOptions(await screen.findByLabelText("Objective (fitness function)"), "staple_scaffold_complementarity");
    expect(screen.getByText(/Base pairing only; not a measure of folding yield/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start batch (1 job)" }));
    const submitting = await screen.findByRole("button", { name: "Submitting…" });
    expect(submitting).toBeDisabled();
    await userEvent.click(submitting); // ignored while the request is in flight

    const posts = calls(spy, "POST", "/api/v1/batches");
    expect(posts).toHaveLength(1);
    const init = posts[0]![1]!;
    expect(JSON.parse(String(init.body))).toEqual({ dataset_id: dataset.id, design_ids: ["d1"], seed: 7, name: "Nightly batch", fitness: "staple_scaffold_complementarity" });
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeTruthy();
    expect(headers["Content-Type"]).toBe("application/json");

    act(() => release());
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Batch queued with 1 job");
    expect(within(status).getByRole("link", { name: "Nightly batch" })).toHaveAttribute("href", `/batches/${BATCH_ID}`);
  });

  it("lists batches with status, dataset and job counts", async () => {
    serve((method, path) => {
      if (path === "/api/v1/datasets") return page([dataset]);
      if (path === "/api/v1/batches")
        return page([batch({ status: "partially_failed", counts: { queued: 0, running: 0, completed: 2, failed: 1, cancelled: 0 } })]);
      throw new Error(`Unexpected ${method} ${path}`);
    });
    renderApp("/batches");

    const section = await screen.findByRole("region", { name: "Batches" });
    const link = await within(section).findByRole("link", { name: "Nightly batch" });
    expect(link).toHaveAttribute("href", `/batches/${BATCH_ID}`);
    const row = link.closest("tr")!;
    expect(within(row).getByText("partially failed")).toBeInTheDocument();
    expect(await within(row).findByText(dataset.name)).toBeInTheDocument();
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(cells.slice(-5)).toEqual(["3", "2", "1", "0", "0"]); // jobs, completed, failed, running, queued
  });

  it("shows job progress and opens a completed result", async () => {
    const history = [
      { generation: 0, best: -0.06, mean: -0.08 },
      { generation: 1, best: -0.05, mean: -0.07 },
      { generation: 2, best: -0.046875, mean: -0.05 },
    ];
    serve((method, path) => {
      if (path === `/api/v1/batches/${BATCH_ID}`) return json(200, batch());
      if (path === `/api/v1/batches/${BATCH_ID}/jobs`)
        return page([
          job("1", { status: "running", progress: { generation: 40, total: 100, best_fitness: -0.1 } }),
          job("2", { status: "completed", progress: { generation: 100, total: 100 }, result: { result_key: "k", best_fitness: -0.046875, num_genes: 3, fitness_kind: "computational_proxy" } }),
          job("3", { status: "queued" }),
        ]);
      if (path === "/api/v1/jobs/2/history")
        return json(200, { job_id: "2", status: "completed", total_generations: 2, source: "result", history, note: null });
      if (path === "/api/v1/jobs/2/result")
        return json(200, {
          design_id: "synthetic_00002",
          best_genome: [1, 0, 1],
          best_fitness: -0.046875,
          best_components: { mean_gc_deviation: 0.046875 },
          fitness_history: history,
          stopped_early: false,
          selected_variants: [{ staple_id: "s0000", choice: 1, is_original: false, sequence: "ACGT" }],
          parameters: { seed: 42 },
          fitness_function: { name: "synthetic_gc_balance_demo", version: "1.0.0", kind: "computational_proxy", limitations: "Demo only." },
          evaluations: 1400,
          unique_evaluations: 8,
          final_population_fitness: [-0.046875, -0.046875, -0.05, -0.06],
          final_candidates: [
            { rank: 1, genome: [1, 0, 1], fitness: -0.046875, components: { mean_gc_deviation: 0.046875 }, occurrences: 2,
              selections: [{ staple_id: "s0000", choice: 1, is_original: false, sequence: "ACGTTT" }, { staple_id: "s0003", choice: 0, is_original: true, sequence: "GGGCCC" }] },
            { rank: 2, genome: [0, 0, 1], fitness: -0.05, components: {}, occurrences: 1,
              selections: [{ staple_id: "s0000", choice: 0, is_original: true, sequence: "ACGTAA" }, { staple_id: "s0003", choice: 0, is_original: true, sequence: "GGGCCC" }] },
          ],
        });
      throw new Error(`Unexpected ${method} ${path}`);
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp(`/batches/${BATCH_ID}`);

    const jobs = await screen.findByRole("region", { name: "Jobs" });
    const running = (await within(jobs).findByText("synthetic_00001")).closest("tr")!;
    expect(within(running).getByText("40/100")).toBeInTheDocument();
    expect(within(running).getByRole("button", { name: "View progress" })).toBeEnabled();
    const done = within(jobs).getByText("synthetic_00002").closest("tr")!;
    await userEvent.click(within(done).getByRole("button", { name: "View result" }));

    const panel = await screen.findByRole("region", { name: /Analysis: synthetic_00002/ });
    expect(within(panel).getByText("Initial best").nextSibling).toHaveTextContent("-0.060000");
    expect(within(panel).getByText("Final best").nextSibling).toHaveTextContent("-0.046875");
    expect(within(panel).getByText("Improvement").nextSibling).toHaveTextContent("0.013125");
    expect(within(panel).getByRole("img", { name: /Best and mean fitness over 3 recorded generations/ })).toBeInTheDocument();
    expect(within(panel).getByText(/Demo objective \(synthetic data only, not a scientific measure\)/)).toBeInTheDocument();
    expect(within(panel).getByText(/not evidence that the design folds/)).toBeInTheDocument();
    const top = within(panel).getByText("(selected)").closest("tr")!;
    expect(top).toHaveTextContent("[1, 0, 1]");
    await userEvent.click(within(top).getByRole("button", { name: "View details" }));
    expect(within(top).getByText("ACGTTT")).toBeInTheDocument();
    await userEvent.click(within(top).getByRole("button", { name: "Copy sequences" }));
    expect(writeText).toHaveBeenCalledWith("s0000\tvariant 1\tACGTTT\ns0003\toriginal\tGGGCCC");
    expect(within(panel).getByRole("img", { name: /Fitness distribution of 4 individuals/ })).toBeInTheDocument();
  });

  it("shows live history for a running job and explains missing data for older results", async () => {
    serve((method, path) => {
      if (path === `/api/v1/batches/${BATCH_ID}`) return json(200, batch());
      if (path === `/api/v1/batches/${BATCH_ID}/jobs`)
        return page([
          job("1", { status: "running", progress: { generation: 5, total: 100 } }),
          job("2", { status: "completed", result: { result_key: "k", best_fitness: -0.05 } }),
        ]);
      if (path === "/api/v1/jobs/1/history")
        return json(200, { job_id: "1", status: "running", total_generations: 100, source: "live", note: null,
          history: [{ generation: 0, best: -0.07, mean: -0.09 }, { generation: 5, best: -0.06, mean: -0.08 }] });
      if (path === "/api/v1/jobs/2/history")
        return json(200, { job_id: "2", status: "completed", total_generations: 100, source: "unavailable", history: [],
          note: "No generation history was recorded for this job." });
      if (path === "/api/v1/jobs/2/result")
        return json(200, { design_id: "old_design", best_genome: [0], best_fitness: -0.05, best_components: {}, fitness_history: [],
          stopped_early: false, selected_variants: [], parameters: {}, fitness_function: { name: "staple_scaffold_complementarity", kind: "computational_proxy" } });
      throw new Error(`Unexpected ${method} ${path}`);
    });
    renderApp(`/batches/${BATCH_ID}`);
    const jobs = await screen.findByRole("region", { name: "Jobs" });
    await userEvent.click(within((await within(jobs).findByText("synthetic_00001")).closest("tr")!).getByRole("button", { name: "View progress" }));
    let panel = await screen.findByRole("region", { name: /Analysis/ });
    expect(await within(panel).findByText("Current best")).toBeInTheDocument();
    expect(within(panel).getByText("Generation", { selector: "dt" }).nextSibling).toHaveTextContent("5 / 100");
    expect(within(panel).getByText(/Recorded so far by the worker \(running\)/)).toBeInTheDocument();
    expect(within(panel).getByText(/available once the job completes/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(within(within(jobs).getByText("synthetic_00002").closest("tr")!).getByRole("button", { name: "View result" }));
    panel = await screen.findByRole("region", { name: /Analysis: old_design/ });
    expect(within(panel).getByText(/No generation history was recorded/)).toBeInTheDocument();
    expect(within(panel).getByText(/produced before final-population ranking was recorded/)).toBeInTheDocument();
    expect(within(panel).getByText(/Computational proxy:/)).toBeInTheDocument();
  });

  it("disables disallowed actions and reports API errors without exposing the token", async () => {
    const spy = serve((method, path) => {
      if (path === `/api/v1/batches/${BATCH_ID}`)
        return json(200, batch({ status: "partially_failed", counts: { queued: 0, running: 0, completed: 1, failed: 1, cancelled: 0 } }));
      if (path === `/api/v1/batches/${BATCH_ID}/jobs`)
        return page([
          job("1", { status: "completed", result: { best_fitness: -0.05 } }),
          job("2", { status: "failed", error: { code: "FitnessError", message: "demonstration for synthetic data only", retryable: false } }),
        ]);
      if (path === "/api/v1/jobs/1/history")
        return json(200, { job_id: "1", status: "completed", total_generations: 100, source: "unavailable", history: [], note: "No generation history was recorded for this job." });
      if (path === "/api/v1/jobs/1/result")
        return json(200, { design_id: "synthetic_00001", best_genome: [0], best_fitness: -0.05, best_components: {}, fitness_history: [],
          stopped_early: false, selected_variants: [], parameters: {}, fitness_function: { name: "synthetic_gc_balance_demo", kind: "computational_proxy" } });
      if (method === "POST" && path === "/api/v1/jobs/2/retry")
        return json(409, { type: "about:blank", title: "Conflict", status: 409, detail: "Job changed concurrently; reload and try again" });
      throw new Error(`Unexpected ${method} ${path}`);
    });
    renderApp(`/batches/${BATCH_ID}`);

    const jobs = await screen.findByRole("region", { name: "Jobs" });
    const completed = (await within(jobs).findByText("synthetic_00001")).closest("tr")!;
    expect(within(completed).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(completed).getByRole("button", { name: "Retry" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel batch" })).toBeDisabled(); // batch already finished

    const failed = within(jobs).getByText("synthetic_00002").closest("tr")!;
    expect(within(failed).getByText("demonstration for synthetic data only")).toBeInTheDocument();
    await userEvent.click(within(failed).getByRole("button", { name: "Retry" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Job changed concurrently; reload and try again");
    expect(document.body.textContent).not.toContain("oe_test");
    expect(calls(spy, "POST", "/api/v1/jobs/2/retry")).toHaveLength(1);
  });

  it("polls active batches and stops when finished or unmounted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let finished = false;
    const spy = serve((method, path) => {
      if (path === `/api/v1/batches/${BATCH_ID}`)
        return json(200, finished ? batch({ status: "completed", counts: { queued: 0, running: 0, completed: 3, failed: 0, cancelled: 0 } }) : batch());
      if (path === `/api/v1/batches/${BATCH_ID}/jobs`)
        return page([job("1", finished ? { status: "completed", result: { best_fitness: -0.05 } } : { status: "running" })]);
      if (path === "/api/v1/batches") return page([]);
      throw new Error(`Unexpected ${method} ${path}`);
    });
    const batchCalls = () => calls(spy, "GET", `/api/v1/batches/${BATCH_ID}`).length;

    const view = renderApp(`/batches/${BATCH_ID}`);
    await screen.findByText(/updates automatically/);
    const initial = batchCalls();
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2 + 100));
    expect(batchCalls()).toBeGreaterThan(initial); // polling while active

    finished = true;
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100));
    await waitFor(() => expect(screen.queryByText(/updates automatically/)).not.toBeInTheDocument());
    const afterFinish = batchCalls();
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5));
    expect(batchCalls()).toBe(afterFinish); // stopped once everything is final

    // An active batch stops polling when the page unmounts.
    finished = false;
    view.unmount();
    const remount = renderApp(`/batches/${BATCH_ID}`);
    await screen.findByText(/updates automatically/);
    remount.unmount();
    const atUnmount = batchCalls();
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5));
    expect(batchCalls()).toBe(atUnmount);
  });

  it("opens the generation chart automatically, keeps it after refresh and keeps flat lines off the border", async () => {
    const flat = Array.from({ length: 101 }, (_, g) => ({ generation: g, best: -0.08203125, mean: -0.0875 + g * 0.00005 }));
    serve((method, path) => {
      if (path === `/api/v1/batches/${BATCH_ID}`) return json(200, batch({ status: "completed" }));
      if (path === `/api/v1/batches/${BATCH_ID}/jobs`)
        return page([job("1", { status: "completed", result: { best_fitness: -0.08203125 } }), job("2", { status: "completed", result: { best_fitness: -0.05 } })]);
      if (path === "/api/v1/jobs/1/history" || path === "/api/v1/jobs/2/history")
        return json(200, { job_id: path.split("/")[4], status: "completed", total_generations: 100, source: "result", history: flat, note: null });
      if (path === "/api/v1/jobs/1/result" || path === "/api/v1/jobs/2/result")
        return json(200, { design_id: `design_${path.split("/")[4]}`, best_genome: [1], best_fitness: -0.08203125, best_components: {}, fitness_history: flat,
          stopped_early: false, selected_variants: [], parameters: {}, fitness_function: { name: "synthetic_gc_balance_demo", kind: "computational_proxy" } });
      throw new Error(`Unexpected ${method} ${path}`);
    });

    const first = renderApp(`/batches/${BATCH_ID}`); // no click needed
    const chart = await screen.findByRole("img", { name: /Best and mean fitness over 101 recorded generations/ });
    expect(screen.getByRole("region", { name: /Analysis: design_1/ })).toBeInTheDocument();
    expect(within(chart).getByText("Generation")).toBeInTheDocument();
    expect(within(chart).getByText("Fitness")).toBeInTheDocument();
    const best = chart.querySelector('polyline[data-series="best"]')!;
    const mean = chart.querySelector('polyline[data-series="mean"]')!;
    expect(best.getAttribute("points")!.split(" ")).toHaveLength(101);
    expect(mean.getAttribute("points")!.split(" ")).toHaveLength(101);
    const bestY = new Set(best.getAttribute("points")!.split(" ").map((p) => Number(p.split(",")[1])));
    expect(bestY.size).toBe(1); // a genuinely flat best line...
    expect([...bestY][0]).toBeGreaterThan(12 + 5); // ...drawn inside the plot, not on the top border
    first.unmount();

    const refreshed = renderApp(`/batches/${BATCH_ID}?job=2`); // URL keeps the chosen job across a refresh
    expect(await screen.findByRole("region", { name: /Analysis: design_2/ })).toBeInTheDocument();
    refreshed.unmount();

    renderApp(`/batches/${BATCH_ID}?job=none`); // closed stays closed
    await screen.findByRole("region", { name: "Jobs" });
    expect(screen.queryByRole("region", { name: /Analysis/ })).not.toBeInTheDocument();
  });
});
