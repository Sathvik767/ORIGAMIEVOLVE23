import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, CircleCheck, FlaskConical, ListChecks, Rocket, RotateCcw, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";

import { api, type BatchCreate, type BatchOut, type DesignCompatibility } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { useToken } from "../../components/TokenContext";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Callout, LoadingBlock } from "../../components/ui/Feedback";
import { Checkbox, Field, Input, Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";
import { cx } from "../../lib/cx";
import { formatCount } from "../../lib/format";
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
  const toast = useToast();
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
      toast(`Batch created with ${batch.total_jobs} job${batch.total_jobs === 1 ? "" : "s"}`);
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
  const objectiveLabel = objective?.name ?? fitness;
  const methodLabel = METHODS.find((m) => m.value === method)?.label.split(" (")[0] ?? method;
  return (
    <Card
      title="New batch"
      icon={<Rocket className="size-4" />}
      description="One independent optimization job per selected design. GA settings default to population 50 and 100 generations (change them under Advanced GA settings). Only designs with supplied staple variants that the chosen objective can score are selectable."
    >
      {datasets.error && (
        <div className="mb-4">
          <ErrorMessage error={datasets.error} onRetry={() => void datasets.refetch()} />
        </div>
      )}

      <form onSubmit={onSubmit} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <ol className="min-w-0 space-y-6">
          <Step n={1} title="Choose dataset" done={Boolean(datasetId)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Validated dataset">
                <Select
                  value={datasetId}
                  onChange={(e) => {
                    changed();
                    setDatasetId(e.target.value);
                    setSelected(new Set());
                    setWholeDataset(false);
                  }}
                >
                  <option value="">{datasets.isPending ? "Loading…" : "choose…"}</option>
                  {validated.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.counts.designs_valid ?? 0} designs)
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {datasets.data && validated.length === 0 && (
              <p className="mt-3 text-sm text-muted">
                No validated datasets yet.{" "}
                <Link to="/datasets" className="font-medium text-primary underline">
                  Upload one
                </Link>{" "}
                first.
              </p>
            )}
          </Step>

          <Step n={2} title="Select designs" done={jobCount > 0}>
            {!datasetId && <p className="text-sm text-muted">Choose a dataset first.</p>}
            {datasetId && fitness === DEMO_OBJECTIVE && incompatible.length > 0 && (
              <Callout role="note" tone="danger" icon={<TriangleAlert />} className="mb-3">
                The default demo objective cannot be used on{" "}
                {incompatible.length === allDesigns.length ? "this dataset" : `${incompatible.length} of the loaded designs`}: it
                only scores designs marked <span className="font-mono">metadata.source = synthetic</span>. Choose another objective
                (e.g. <span className="font-mono">staple_scaffold_complementarity</span>) for real designs.
              </Callout>
            )}
            {compatError && (
              <div className="mb-3">
                <ErrorMessage error={compatError} />
              </div>
            )}
            {datasetId && (
              <fieldset className="overflow-hidden rounded-lg border border-border">
                <legend className="sr-only">Designs</legend>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-raised/60 px-3 py-2">
                  <Checkbox
                    checked={allSelected && !wholeDataset}
                    disabled={optimizable.length === 0}
                    onChange={toggleAll}
                    label={`Select all valid designs${designs.hasNextPage ? " (loaded so far)" : ""}`}
                  />
                  {designs.hasNextPage && (
                    <Checkbox
                      checked={wholeDataset}
                      onChange={() => {
                        changed();
                        setSelected(new Set());
                        setWholeDataset(!wholeDataset);
                      }}
                      label={`Select all designs in dataset (${dataset?.counts.designs_valid ?? "?"})`}
                    />
                  )}
                  <Badge tone={jobCount > 0 ? "primary" : "neutral"}>
                    {wholeDataset ? "all designs in dataset" : `${chosen.length} selected`}
                  </Badge>
                </div>
                {wholeDataset && (
                  <p className="border-b border-border px-3 py-1.5 text-xs text-muted">
                    The server checks every design (variants and objective compatibility) and refuses the batch, listing the
                    problems, if any design cannot be optimized.
                  </p>
                )}
                {designs.isPending && (
                  <div className="p-3">
                    <LoadingBlock label="Loading designs…" rows={3} />
                  </div>
                )}
                {designs.error && (
                  <div className="p-3">
                    <ErrorMessage error={designs.error} onRetry={() => void designs.refetch()} />
                  </div>
                )}
                {designs.data && allDesigns.length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted">This dataset has no stored designs.</p>
                )}
                <ul className="max-h-72 divide-y divide-border/60 overflow-auto">
                  {allDesigns.map((d) => {
                    const reason = blockedReason(d);
                    const disabled = reason !== null || wholeDataset;
                    return (
                      <li key={d.id}>
                        <label
                          className={cx(
                            "flex items-center gap-3 px-3 py-2 text-sm transition-colors duration-150",
                            reason !== null ? "cursor-not-allowed text-subtle" : "cursor-pointer hover:bg-surface-raised/70",
                          )}
                          title={reason ?? undefined}
                        >
                          <input
                            type="checkbox"
                            className="size-4"
                            checked={selected.has(d.id)}
                            disabled={disabled}
                            onChange={() => toggle(d.id)}
                          />
                          <span className="font-mono text-xs">{d.external_id}</span>
                          <span className="truncate text-muted">{d.name ?? ""}</span>
                          <span
                            className={cx(
                              "ml-auto max-w-[50%] truncate text-right text-xs",
                              reason && reason !== "no variants" && reason !== "checking objective…" ? "text-danger" : "text-subtle",
                            )}
                          >
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
                    className="w-full border-t border-border px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-surface-raised disabled:opacity-50"
                  >
                    Load more designs
                  </button>
                )}
              </fieldset>
            )}
          </Step>

          <Step n={3} title="Objective & seed" done={seedValid && gaInvalid.length === 0}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Objective (fitness function)">
                <Select value={fitness} onChange={(e) => chooseObjective(e.target.value)}>
                  {(objectives.data ?? [{ name: DEMO_OBJECTIVE }]).map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Search method">
                <Select
                  value={method}
                  onChange={(e) => {
                    changed();
                    setMethod(e.target.value as Method);
                  }}
                >
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Random seed">
                <Input
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
                  className="font-mono"
                />
              </Field>
              <Field label="Batch name (optional)">
                <Input
                  value={name}
                  maxLength={200}
                  onChange={(e) => {
                    changed();
                    setName(e.target.value);
                  }}
                />
              </Field>
            </div>
            {!seedValid && <p className="mt-2 text-xs text-danger">Seed must be a whole number from 0 to {MAX_SEED}.</p>}
            {objective && (
              <Callout tone="warning" icon={<FlaskConical />} className="mt-3 text-xs">
                <strong>{objective.kind.replaceAll("_", " ")}:</strong> {objective.description} <em>Limitations:</em>{" "}
                {objective.limitations} <em>Requires:</em> {objective.requires}
              </Callout>
            )}

            <details className="group mt-3 rounded-lg border border-border">
              <summary className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-raised">
                <ChevronRight aria-hidden className="size-4 text-subtle transition-transform duration-150 group-open:rotate-90" />
                <SlidersHorizontal aria-hidden className="size-4 text-subtle" />
                Advanced GA settings
              </summary>
              <div className="border-t border-border p-3">
                <p className="text-xs text-muted">
                  Used when the GA runs (method GA, or Auto on larger search spaces). The server enforces upper limits
                  (population ≤ 500, generations ≤ 1000) and checks the values (e.g. elitism below the population size).
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {GA_FIELDS.map(({ key, label, step }) => (
                    <Field key={key} label={label}>
                      <Input
                        type="number"
                        step={step}
                        min={0}
                        value={ga[key]}
                        onChange={(e) => {
                          changed();
                          setGA((prev) => ({ ...prev, [key]: e.target.value }));
                        }}
                        aria-invalid={gaInvalid.includes(label)}
                        className="font-mono"
                      />
                    </Field>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  icon={<RotateCcw aria-hidden className="size-3.5" />}
                  onClick={() => {
                    changed();
                    setGA(defaultGA());
                  }}
                >
                  Reset to defaults
                </Button>
                {gaInvalid.length > 0 && (
                  <p className="mt-1 text-xs text-danger">Enter a non-negative number for: {gaInvalid.join(", ")}.</p>
                )}
              </div>
            </details>
          </Step>
        </ol>

        <aside aria-label="Review and start" className="h-fit rounded-xl border border-border bg-surface-raised/50 p-4 xl:sticky xl:top-20">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <ListChecks aria-hidden className="size-4 text-primary" />
            Review &amp; start
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <SummaryRow label="Dataset" value={dataset?.name ?? "—"} />
            <SummaryRow label="Objective" value={<span className="font-mono text-xs break-all">{objectiveLabel}</span>} />
            <SummaryRow label="Method" value={methodLabel} />
            <SummaryRow label="Seed" value={<span className="font-mono">{seedValid ? seed : "—"}</span>} />
          </dl>
          <div className="mt-4 rounded-lg border border-primary/25 bg-primary-soft px-3 py-2.5">
            <p className="text-xs text-muted">Jobs to create</p>
            <p className="font-mono text-2xl font-semibold text-primary">{formatCount(jobCount)}</p>
            <p className="text-xs text-muted">one per design</p>
          </div>
          <Button
            type="submit"
            variant="primary"
            className="mt-4 w-full"
            disabled={submit.isPending || !canSubmit}
            icon={submit.isPending ? undefined : <Rocket aria-hidden className="size-4" />}
          >
            {submit.isPending ? "Submitting…" : `Start batch (${jobCount} job${jobCount === 1 ? "" : "s"})`}
          </Button>
          {created && (
            <p role="status" className="mt-3 text-sm text-fg">
              <CircleCheck aria-hidden className="mr-1 inline size-4 text-success" />
              Batch queued with {created.total_jobs} job{created.total_jobs === 1 ? "" : "s"}:{" "}
              <Link to={`/batches/${created.id}`} className="font-medium text-primary underline">
                {created.name ?? created.id}
              </Link>
            </p>
          )}
          {submit.error && (
            <div className="mt-3">
              <ErrorMessage error={submit.error} />
            </div>
          )}
        </aside>
      </form>
    </Card>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <li className="relative pl-10">
      <span
        aria-hidden
        className={cx(
          "absolute top-0 left-0 grid size-7 place-items-center rounded-full border font-mono text-xs font-semibold transition-colors duration-150",
          done ? "border-primary/50 bg-primary-soft text-primary" : "border-border bg-surface-raised text-muted",
        )}
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <h3 className="mb-3 pt-0.5 text-sm font-semibold text-fg">
        <span className="sr-only">Step {n}:</span> {title}
      </h3>
      {children}
    </li>
  );
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-fg">{value}</dd>
    </div>
  );
}
