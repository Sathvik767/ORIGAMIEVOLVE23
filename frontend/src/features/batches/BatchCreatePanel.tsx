import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";

import { api, type BatchCreate, type BatchOut } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { useToken } from "../../components/TokenContext";
import { newIdempotencyKey } from "./status";

const DEFAULT_SEED = 42;
const DEFAULT_FITNESS = "synthetic_gc_balance_demo";
const MAX_SEED = 2 ** 32 - 1;

export function BatchCreatePanel() {
  const { token } = useToken();
  const queryClient = useQueryClient();
  const [datasetId, setDatasetId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [seed, setSeed] = useState(String(DEFAULT_SEED));
  const [fitness, setFitness] = useState(DEFAULT_FITNESS);
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
  const optimizable = allDesigns.filter((d) => d.candidate_count > 0);
  const allSelected = optimizable.length > 0 && optimizable.every((d) => selected.has(d.id));

  const seedNumber = Number(seed);
  const seedValid = seed.trim() !== "" && Number.isInteger(seedNumber) && seedNumber >= 0 && seedNumber <= MAX_SEED;

  const submit = useMutation({
    mutationFn: (body: BatchCreate) => api.createBatch(body, idempotencyKey.current ?? newIdempotencyKey()),
    onSuccess: (batch) => {
      setCreated(batch);
      setSelected(new Set());
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
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    changed();
    setSelected(allSelected ? new Set() : new Set(optimizable.map((d) => d.id)));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submit.isPending || !datasetId || selected.size === 0 || !seedValid) return;
    idempotencyKey.current ??= newIdempotencyKey();
    submit.mutate({
      dataset_id: datasetId,
      design_ids: [...selected],
      seed: seedNumber,
      fitness,
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
        One independent optimization job per selected design, using the fixed GA settings (population 50, 100
        generations). Only designs with supplied staple variants can be optimized.
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Objective (fitness function)</span>
          <select
            value={fitness}
            onChange={(e) => {
              changed();
              setFitness(e.target.value);
            }}
            className="rounded border border-slate-300 px-2 py-1 sm:w-1/2"
          >
            {(objectives.data ?? [{ name: DEFAULT_FITNESS }]).map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        {objective && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>{objective.kind.replaceAll("_", " ")}:</strong> {objective.description} <em>Limitations:</em>{" "}
            {objective.limitations} <em>Requires:</em> {objective.requires}
          </p>
        )}
        {datasets.data && validated.length === 0 && (
          <p className="text-sm text-slate-500">
            No validated datasets yet. <Link to="/datasets" className="underline">Upload one</Link> first.
          </p>
        )}

        {datasetId && (
          <fieldset className="rounded border border-slate-200">
            <legend className="sr-only">Designs</legend>
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={optimizable.length === 0}
                  onChange={toggleAll}
                />
                Select all valid designs{designs.hasNextPage ? " (loaded so far)" : ""}
              </label>
              <span className="text-slate-500">{selected.size} selected</span>
            </div>
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
                const disabled = d.candidate_count === 0;
                return (
                  <li key={d.id}>
                    <label
                      className={`flex items-center gap-3 px-3 py-1.5 text-sm ${disabled ? "text-slate-400" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(d.id)}
                        disabled={disabled}
                        onChange={() => toggle(d.id)}
                      />
                      <span className="font-mono text-xs">{d.external_id}</span>
                      <span className="truncate">{d.name ?? ""}</span>
                      <span className="ml-auto whitespace-nowrap text-xs text-slate-500">
                        {disabled ? "no variants" : `${d.candidate_count} variants`}
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
          disabled={submit.isPending || !datasetId || selected.size === 0 || !seedValid}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {submit.isPending ? "Submitting…" : `Start batch (${selected.size} job${selected.size === 1 ? "" : "s"})`}
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
