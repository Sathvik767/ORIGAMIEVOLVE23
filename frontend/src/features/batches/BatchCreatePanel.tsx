import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";

import { api, type BatchCreate, type BatchOut, type DesignCompatibility } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { useToken } from "../../components/TokenContext";
import { DEMO_OBJECTIVE, GA_DEFAULTS, newIdempotencyKey, type GASettings } from "./status";

const DEFAULT_SEED = 42;
const MAX_SEED = 2 ** 32 - 1;
type Method = BatchCreate["method"];

const METHODS: { value: Method; label: string }[] = [
  { value: "auto", label: "Auto (exhaustive search for ≤ 4096 combinations, otherwise GA)" },
  { value: "ga", label: "Genetic algorithm" },
  { value: "exhaustive", label: "Exhaustive search (every combination)" },
];

const GA_FIELDS: { key: keyof GASettings; label: string; step: string; integer: boolean }[] = [
  { key: "population_size", label: "Population size", step: "1", integer: true },
  { key: "generations", label: "Generations", step: "1", integer: true },
  { key: "mutation_rate", label: "Mutation rate (0–1)", step: "0.01", integer: false },
  { key: "crossover_rate", label: "Crossover rate (0–1)", step: "0.01", integer: false },
  { key: "elitism", label: "Elitism", step: "1", integer: true },
  { key: "tournament_size", label: "Tournament size", step: "1", integer: true },
];

const defaultGA = (): Record<keyof GASettings, string> =>
  Object.fromEntries(Object.entries(GA_DEFAULTS).map(([k, v]) => [k, String(v)])) as Record<keyof GASettings, string>;

export function BatchCreatePanel() {
  const { token } = useToken();
  const queryClient = useQueryClient();
  const [datasetId, setDatasetId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // True = the request omits design_ids, so the server uses every design in the dataset (all pages).
  const [wholeDataset, setWholeDataset] = useState(false);
  const [name, setName] = useState("");
  const [seed, setSeed] = useState(String(DEFAULT_SEED));
  const [fitness, setFitness] = useState(DEMO_OBJECTIVE);
  const [method, setMethod] = useState<Method>("auto");
  const [ga, setGA] = useState(defaultGA);
  const [created, setCreated] = useState<BatchOut | null>(null);
  // Reused if the same submission is retried (e.g. after a network error), so the server
  // returns the original batch instead of creating a duplicate.
  const idempotencyKey = useRef<string | null>(null);

  const datasets = useQuery({
    queryKey: ["datasets", "list"],
    queryFn: () => api.listDatasets(),
    enabled: Boolean(token),
  });
  const validated = (datasets.data?.items ?? []).filter(
    (d) => d.status === "ready" || d.status === "ready_with_errors",
  );
  const dataset = validated.find((d) => d.id === datasetId);

  const objectives = useQuery({
    queryKey: ["fitness-functions"],
    queryFn: api.listFitnessFunctions,
    enabled: Boolean(token),
    staleTime: Infinity,
  });
  const objective = objectives.data?.find((f) => f.name === fitness);

  const designs = useInfiniteQuery({
    queryKey: ["datasets", datasetId, "designs", "for-batch"],
    queryFn: ({ pageParam }) => api.listDesigns(datasetId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(token && datasetId),
  });
  const allDesigns = useMemo(() => designs.data?.pages.flatMap((p) => p.items) ?? [], [designs.data]);

  // Objective compatibility, page by page alongside the loaded designs (same cursor and page size).
  const compatPages = useQueries({
    queries: (designs.data?.pageParams ?? []).map((cursor) => ({
      queryKey: ["datasets", datasetId, "compatibility", fitness, cursor ?? null],
      queryFn: () => api.designCompatibility(datasetId, fitness, cursor as string | undefined),
      enabled: Boolean(token && datasetId),
      staleTime: 60_000,
    })),
  });
  const compat = useMemo(() => {
    const map = new Map<string, DesignCompatibility>();
    for (const page of compatPages) for (const c of page.data?.items ?? []) map.set(c.design_id, c);
    return map;
  }, [compatPages]);
  const compatError = compatPages.find((p) => p.error)?.error;
  const checking = compatPages.some((p) => p.isPending);

  const blockedReason = (d: { id: string; candidate_count: number }): string | null => {
    if (d.candidate_count === 0) return "no variants";
    const c = compat.get(d.id);
    if (!c) return checking ? "checking objective…" : null;
    return c.compatible ? null : (c.reason ?? "objective cannot score this design");
  };
  const optimizable = allDesigns.filter((d) => blockedReason(d) === null);
  const incompatible = allDesigns.filter((d) => d.candidate_count > 0 && compat.get(d.id)?.compatible === false);
  const allSelected = optimizable.length > 0 && optimizable.every((d) => selected.has(d.id));
  // A selection survives an objective change; designs the new objective cannot score drop out of it.
  const chosen = optimizable.filter((d) => selected.has(d.id)).map((d) => d.id);

  const seedNumber = Number(seed);
  const seedValid = seed.trim() !== "" && Number.isInteger(seedNumber) && seedNumber >= 0 && seedNumber <= MAX_SEED;
  const gaInvalid = GA_FIELDS.filter(({ key, integer }) => {
    const v = Number(ga[key]);
    return ga[key].trim() === "" || !Number.isFinite(v) || (integer && !Number.isInteger(v)) || v < 0;
  }).map((f) => f.label);
  const jobCount = wholeDataset ? (dataset?.counts.designs_valid ?? 0) : chosen.length;
  const canSubmit = Boolean(datasetId) && jobCount > 0 && seedValid && gaInvalid.length === 0;

  const submit = useMutation({
    mutationFn: (body: BatchCreate) => api.createBatch(body, idempotencyKey.current ?? newIdempotencyKey()),
    onSuccess: (batch) => {
      setCreated(batch);
      setSelected(new Set());
      setWholeDataset(false);
      setName("");
      idempotencyKey.current = null;
      void queryClient.invalidateQueries({ queryKey: ["batches"] });
    },
  });

  function changed() {
    idempotencyKey.current = null; // different request => different key
    setCreated(null);
    submit.reset();
  }

  function toggle(id: string) {
    changed();
    setWholeDataset(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    changed();
    setWholeDataset(false);
    setSelected(allSelected ? new Set() : new Set(optimizable.map((d) => d.id)));
  }

  function chooseObjective(value: string) {
    changed();
    setFitness(value);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submit.isPending || !canSubmit) return;
    idempotencyKey.current ??= newIdempotencyKey();
    const overrides = Object.fromEntries(GA_FIELDS.map(({ key }) => [key, Number(ga[key])])) as GASettings;
    submit.mutate({
      dataset_id: datasetId,
      ...(wholeDataset ? {} : { design_ids: chosen }),
      seed: seedNumber,
      fitness,
      method,
      ...overrides,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
  }

  if (!token) return null;
  return (
    <section aria-labelledby="new-batch-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="new-batch-heading" className="mb-1 text-lg font-semibold text-slate-800">
        New batch
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        One independent optimization job per selected design. GA settings default to population 50 and 100
        generations (change them under Advanced GA settings). Only designs with supplied staple variants that the
        chosen objective can score are selectable.
      </p>
      {datasets.error && <ErrorMessage error={datasets.error} />}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr]">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Validated dataset</span>
            <select
              value={datasetId}
              onChange={(e) => {
                changed();
                setDatasetId(e.target.value);
                setSelected(new Set());
                setWholeDataset(false);
              }}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="">{datasets.isPending ? "Loading…" : "choose…"}</option>
              {validated.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.counts.designs_valid ?? 0} designs)
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Batch name (optional)</span>
            <input
              value={name}
              maxLength={200}
              onChange={(e) => {
                changed();
                setName(e.target.value);
              }}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Random seed</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_SEED}
              step={1}
              value={seed}
              onChange={(e) => {
                changed();
                setSeed(e.target.value);
              }}
              aria-invalid={!seedValid}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
        </div>
        {!seedValid && <p className="text-xs text-red-700">Seed must be a whole number from 0 to {MAX_SEED}.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Objective (fitness function)</span>
            <select
              value={fitness}
              onChange={(e) => chooseObjective(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              {(objectives.data ?? [{ name: DEMO_OBJECTIVE }]).map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Search method</span>
            <select
              value={method}
              onChange={(e) => {
                changed();
                setMethod(e.target.value as Method);
              }}
              className="rounded border border-slate-300 px-2 py-1"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {objective && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>{objective.kind.replaceAll("_", " ")}:</strong> {objective.description} <em>Limitations:</em>{" "}
            {objective.limitations} <em>Requires:</em> {objective.requires}
          </p>
        )}

        <details className="rounded border border-slate-200 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-slate-700">Advanced GA settings</summary>
          <p className="mt-2 text-xs text-slate-500">
            Used when the GA runs (method GA, or Auto on larger search spaces). The server enforces upper limits
            (population ≤ 500, generations ≤ 1000) and checks the values (e.g. elitism below the population size).
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {GA_FIELDS.map(({ key, label, step }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-slate-600">{label}</span>
                <input
                  type="number"
                  step={step}
                  min={0}
                  value={ga[key]}
                  onChange={(e) => {
                    changed();
                    setGA((prev) => ({ ...prev, [key]: e.target.value }));
                  }}
                  aria-invalid={gaInvalid.includes(label)}
                  className="rounded border border-slate-300 px-2 py-1"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              changed();
              setGA(defaultGA());
            }}
            className="mt-2 text-xs text-slate-600 underline"
          >
            Reset to defaults
          </button>
          {gaInvalid.length > 0 && (
            <p className="mt-1 text-xs text-red-700">Enter a non-negative number for: {gaInvalid.join(", ")}.</p>
          )}
        </details>

        {datasets.data && validated.length === 0 && (
          <p className="text-sm text-slate-500">
            No validated datasets yet. <Link to="/datasets" className="underline">Upload one</Link> first.
          </p>
        )}

        {datasetId && fitness === DEMO_OBJECTIVE && incompatible.length > 0 && (
          <p role="note" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
            The default demo objective cannot be used on {incompatible.length === allDesigns.length ? "this dataset" : `${incompatible.length} of the loaded designs`}:
            it only scores designs marked <span className="font-mono">metadata.source = synthetic</span>. Choose another
            objective (e.g. <span className="font-mono">staple_scaffold_complementarity</span>) for real designs.
          </p>
        )}
        {compatError && <ErrorMessage error={compatError} />}

        {datasetId && (
          <fieldset className="rounded border border-slate-200">
            <legend className="sr-only">Designs</legend>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allSelected && !wholeDataset}
                  disabled={optimizable.length === 0}
                  onChange={toggleAll}
                />
                Select all valid designs{designs.hasNextPage ? " (loaded so far)" : ""}
              </label>
              {designs.hasNextPage && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={wholeDataset}
                    onChange={() => {
                      changed();
                      setSelected(new Set());
                      setWholeDataset(!wholeDataset);
                    }}
                  />
                  Select all designs in dataset ({dataset?.counts.designs_valid ?? "?"})
                </label>
              )}
              <span className="text-slate-500">
                {wholeDataset ? "all designs in dataset" : `${chosen.length} selected`}
              </span>
            </div>
            {wholeDataset && (
              <p className="border-b border-slate-100 px-3 py-1.5 text-xs text-slate-500">
                The server checks every design (variants and objective compatibility) and refuses the batch, listing
                the problems, if any design cannot be optimized.
              </p>
            )}
            {designs.isPending && <p className="px-3 py-2 text-sm text-slate-500">Loading designs…</p>}
            {designs.error && (
              <div className="p-3">
                <ErrorMessage error={designs.error} />
              </div>
            )}
            {designs.data && allDesigns.length === 0 && (
              <p className="px-3 py-2 text-sm text-slate-500">This dataset has no stored designs.</p>
            )}
            <ul className="max-h-64 divide-y divide-slate-50 overflow-auto">
              {allDesigns.map((d) => {
                const reason = blockedReason(d);
                const disabled = reason !== null || wholeDataset;
                return (
                  <li key={d.id}>
                    <label
                      className={`flex items-center gap-3 px-3 py-1.5 text-sm ${reason !== null ? "text-slate-400" : ""}`}
                      title={reason ?? undefined}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(d.id)}
                        disabled={disabled}
                        onChange={() => toggle(d.id)}
                      />
                      <span className="font-mono text-xs">{d.external_id}</span>
                      <span className="truncate">{d.name ?? ""}</span>
                      <span className="ml-auto max-w-[50%] truncate text-right text-xs text-slate-500">
                        {reason ?? `${d.candidate_count} variants`}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {designs.hasNextPage && (
              <button
                type="button"
                onClick={() => void designs.fetchNextPage()}
                disabled={designs.isFetchingNextPage}
                className="w-full border-t border-slate-100 px-3 py-1.5 text-sm text-slate-600 underline"
              >
                Load more designs
              </button>
            )}
          </fieldset>
        )}

        <button
          type="submit"
          disabled={submit.isPending || !canSubmit}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {submit.isPending ? "Submitting…" : `Start batch (${jobCount} job${jobCount === 1 ? "" : "s"})`}
        </button>
      </form>

      {created && (
        <p role="status" className="mt-3 text-sm text-emerald-800">
          Batch queued with {created.total_jobs} job{created.total_jobs === 1 ? "" : "s"}:{" "}
          <Link to={`/batches/${created.id}`} className="underline">
            {created.name ?? created.id}
          </Link>
        </p>
      )}
      {submit.error && (
        <div className="mt-3">
          <ErrorMessage error={submit.error} />
        </div>
      )}
    </section>
  );
}
