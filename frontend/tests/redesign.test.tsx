import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dataset, json, renderApp } from "./utils";

type Handler = (method: string, path: string, url: URL) => Response;
function serve(handler: Handler) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input), "http://localhost");
    return handler(init.method ?? "GET", url.pathname, url);
  });
}
const page = (items: unknown[], next_cursor: string | null = null) => json(200, { items, next_cursor });

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => vi.unstubAllGlobals());

describe("theme", () => {
  it("defaults to dark, toggles to light, remembers the choice and restores it on the next visit", async () => {
    const first = renderApp("/status");
    expect(document.documentElement.dataset.theme).toBe("dark");
    await userEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("origami.theme")).toBe("light");
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toHaveAttribute("aria-pressed", "true");
    first.unmount();

    document.documentElement.removeAttribute("data-theme");
    renderApp("/status");
    expect(document.documentElement.dataset.theme).toBe("light");
    await userEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(localStorage.getItem("origami.theme")).toBe("dark");
  });

  it("follows prefers-color-scheme on a first visit and survives unavailable storage", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("light"), media: q }));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    renderApp("/status");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("overview", () => {
  const batch = (id: string, over: Record<string, unknown>) => ({
    id,
    name: `Batch ${id}`,
    dataset_id: dataset.id,
    status: "completed",
    counts: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 },
    total_jobs: 2,
    params: { seed: 42 },
    fitness: { name: "staple_scaffold_complementarity", version: "1.0.0", kind: "computational_proxy" },
    method: "auto",
    created_at: "2026-10-30T10:00:00Z",
    updated_at: "2026-10-30T10:00:00Z",
    finished_at: null,
    ...over,
  });
  const job = (id: string, best: number) => ({
    id,
    type: "optimize",
    status: "completed",
    batch_id: "b1",
    attempt: 1,
    cancel_requested: false,
    method: "auto",
    fitness: "staple_scaffold_complementarity",
    params: {},
    progress: {},
    error: null,
    result: { best_fitness: best, best_components: {}, method: "exhaustive" },
    updated_at: "2026-10-30T10:00:00Z",
  });

  it("shows stat cards, recent batches and a get-started checklist computed from existing endpoints", async () => {
    sessionStorage.setItem("origami.apiToken", "oe_test");
    serve((method, path) => {
      if (path === "/api/v1/datasets") return page([dataset, { ...dataset, id: "651f00000000000000000002", name: "Other", status: "failed" }]);
      if (path === "/api/v1/batches")
        return page([
          batch("b2", { status: "running", counts: { queued: 0, running: 1, completed: 1, failed: 0, cancelled: 0 }, created_at: "2026-10-31T09:00:00Z" }),
          batch("b1", { counts: { queued: 0, running: 0, completed: 2, failed: 0, cancelled: 0 } }),
        ]);
      if (path === "/api/v1/batches/b1/jobs") return page([job("j1", 0.9375), job("j2", 1)]);
      if (path === "/api/v1/ready") return json(200, { status: "ok", checks: {} });
      throw new Error(`Unexpected ${method} ${path}`);
    });
    renderApp("/");

    const stats = screen.getByLabelText("Summary");
    const value = (label: string) => within(stats).getByText(label).nextSibling as HTMLElement;
    await waitFor(() => expect(value("Datasets")).toHaveTextContent("2"));
    expect(within(stats).getByText("1 ready")).toBeInTheDocument();
    expect(value("Batches")).toHaveTextContent("2");
    expect(value("Jobs running")).toHaveTextContent("1");
    expect(value("Jobs completed")).toHaveTextContent("3");
    // Best of the most recent fully completed batch (b1), not of the running one.
    await waitFor(() => expect(value("Best fitness (latest batch)")).toHaveTextContent("1.0000"));

    const recent = screen.getByRole("region", { name: "Recent batches" });
    expect(within(recent).getByRole("link", { name: "Batch b2" })).toHaveAttribute("href", "/batches/b2");
    expect(within(recent).getByText("running")).toBeInTheDocument();

    const checklist = screen.getByRole("list", { name: "Get started checklist" });
    for (const step of ["Add your API token", "Upload a dataset", "Start a batch", "View results"]) {
      expect(within(checklist).getByText(step).parentElement).toHaveTextContent(`${step} (done)`);
    }
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  });

  it("leaves steps unticked for a new user and links to the next action", () => {
    vi.spyOn(globalThis, "fetch");
    renderApp("/");
    const checklist = screen.getByRole("list", { name: "Get started checklist" });
    expect(within(checklist).getByText("Add your API token").parentElement).toHaveTextContent("(to do)");
    expect(within(checklist).getByRole("link", { name: "Upload" })).toHaveAttribute("href", "/datasets");
    expect(within(screen.getByLabelText("Summary")).getByText("Datasets").nextSibling).toHaveTextContent("—");
  });
});

describe("batch creation steps", () => {
  const designs = [
    { id: "d1", external_id: "tile_1", name: null, has_scaffold: true, scaffold_length: 64, staple_count: 8, candidate_count: 3, measurement_names: [] },
    { id: "d2", external_id: "tile_2", name: null, has_scaffold: true, scaffold_length: 64, staple_count: 8, candidate_count: 2, measurement_names: [] },
  ];

  it("ticks each step as it is completed and summarises the jobs to create", async () => {
    sessionStorage.setItem("origami.apiToken", "oe_test");
    serve((method, path) => {
      if (path === "/api/v1/datasets") return page([dataset]);
      if (path === "/api/v1/batches") return page([]);
      if (path === "/api/v1/fitness-functions")
        return json(200, [{ name: "synthetic_gc_balance_demo", version: "1", kind: "computational_proxy", description: "Demo.", limitations: "Demo only.", requires: "synthetic" }]);
      if (path === `/api/v1/datasets/${dataset.id}/designs`) return page(designs);
      if (path === `/api/v1/datasets/${dataset.id}/compatibility`)
        return page(designs.map((d) => ({ design_id: d.id, external_id: d.external_id, compatible: true, reason: null })));
      if (path === "/api/v1/ready") return json(200, { status: "ok", checks: {} });
      throw new Error(`Unexpected ${method} ${path}`);
    });
    renderApp("/batches");

    for (const title of ["Step 1: Choose dataset", "Step 2: Select designs", "Step 3: Objective & seed"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    const review = screen.getByRole("complementary", { name: "Review and start" });
    expect(within(review).getByText("Jobs to create").nextSibling).toHaveTextContent("0");
    expect(within(review).getByRole("button", { name: "Start batch (0 jobs)" })).toBeDisabled();
    expect(screen.getByText("Choose a dataset first.")).toBeInTheDocument();

    await screen.findByRole("option", { name: /Batch A/ });
    await userEvent.selectOptions(screen.getByLabelText("Validated dataset"), dataset.id);
    expect(within(review).getByText("Dataset").nextSibling).toHaveTextContent("Batch A");
    await screen.findByText("3 variants");
    await userEvent.click(screen.getByLabelText(/Select all valid designs/));
    expect(within(review).getByText("Jobs to create").nextSibling).toHaveTextContent("2");
    expect(within(review).getByText("Seed").nextSibling).toHaveTextContent("42");
    expect(within(review).getByText("Method").nextSibling).toHaveTextContent("Auto");
    expect(within(review).getByRole("button", { name: "Start batch (2 jobs)" })).toBeEnabled();

    await userEvent.clear(screen.getByLabelText("Random seed"));
    expect(within(review).getByText("Seed").nextSibling).toHaveTextContent("—");
    expect(within(review).getByRole("button", { name: "Start batch (2 jobs)" })).toBeDisabled();
  });
});
