import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link } from "react-router";

import { api, type GenerationPoint, type JobStatus, type OptimizationResult, type RankedCandidate } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { StatusBadge } from "../../components/StatusBadge";
import { formatFitness, POLL_INTERVAL_MS } from "./status";

const DEMO_OBJECTIVE = "synthetic_gc_balance_demo";

function objectiveLabel(name: string): string {
  return name === DEMO_OBJECTIVE ? "Demo objective (synthetic data only, not a scientific measure)" : "Computational proxy";
}

/** Trailing generations whose best fitness equals the latest best (a plateau, stated as a fact). */
function plateauLength(history: GenerationPoint[]): number {
  if (history.length === 0) return 0;
  const last = history[history.length - 1]!.best;
  let k = 0;
  for (let i = history.length - 1; i >= 0 && history[i]!.best === last; i--) k++;
  return k;
}

/** Interactive line chart of recorded best and mean fitness per generation (dependency-free SVG). */
function GenerationChart({ history, total }: { history: GenerationPoint[]; total: number | null }) {
  const [hover, setHover] = useState<GenerationPoint | null>(null);
  if (history.length < 2) {
    return <p className="text-xs text-slate-500">The chart appears once at least two generations are recorded.</p>;
  }
  const W = 640;
  const H = 240;
  const L = 76;
  const R = 12;
  const T = 12;
  const B = 40;
  const values = history.flatMap((h) => [h.best, h.mean]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = (rawMax - rawMin) * 0.1 || Math.abs(rawMax) * 0.05 || 0.05;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const span = max - min;
  const lastGen = Math.max(total ?? 0, history[history.length - 1]!.generation, 1);
  const x = (g: number) => L + (g / lastGen) * (W - L - R);
  const y = (v: number) => T + (1 - (v - min) / span) * (H - T - B);
  const line = (key: "best" | "mean") => history.map((h) => `${x(h.generation)},${y(h[key])}`).join(" ");
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const g = ((((e.clientX - rect.left) / rect.width) * W - L) / (W - L - R)) * lastGen;
    let near = history[0]!;
    for (const h of history) if (Math.abs(h.generation - g) < Math.abs(near.generation - g)) near = h;
    setHover(near);
  };
  return (
    <figure>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-64 w-full rounded border border-slate-100 bg-white"
          role="img"
          aria-label={`Best and mean fitness over ${history.length} recorded generations`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={W - R} y1={y(min + f * span)} y2={y(min + f * span)} stroke="#e2e8f0" />
              <text x={L - 6} y={y(min + f * span) + 4} textAnchor="end" fontSize="10" fill="#64748b">
                {formatFitness(min + f * span)}
              </text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={f} x={x(f * lastGen)} y={H - 22} textAnchor="middle" fontSize="10" fill="#64748b">
              {Math.round(f * lastGen)}
            </text>
          ))}
          <text x={L + (W - L - R) / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#334155">
            Generation
          </text>
          <text x={12} y={T + (H - T - B) / 2} textAnchor="middle" fontSize="11" fill="#334155" transform={`rotate(-90 12 ${T + (H - T - B) / 2})`}>
            Fitness
          </text>
          <polyline points={line("mean")} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3" data-series="mean" />
          <polyline points={line("best")} fill="none" stroke="#0f766e" strokeWidth="3" data-series="best" />
          {hover && (
            <g>
              <line x1={x(hover.generation)} x2={x(hover.generation)} y1={T} y2={H - B} stroke="#cbd5e1" />
              <circle cx={x(hover.generation)} cy={y(hover.best)} r="4" fill="#0f766e" />
              <circle cx={x(hover.generation)} cy={y(hover.mean)} r="3.5" fill="#94a3b8" />
            </g>
          )}
        </svg>
        {hover && (
          <div role="tooltip" className="pointer-events-none absolute right-2 top-2 rounded border border-slate-200 bg-white/95 px-2 py-1 text-xs shadow">
            Generation {hover.generation} · best {formatFitness(hover.best)} · mean {formatFitness(hover.mean)}
          </div>
        )}
      </div>
      <figcaption className="mt-1 flex flex-wrap gap-4 text-xs text-slate-500">
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-teal-700 align-middle" />
          best fitness
        </span>
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-400 align-middle" />
          average (mean) fitness
        </span>
        <span>x: generation · hover for values</span>
      </figcaption>
    </figure>
  );
}

function Distribution({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return <p className="text-xs text-slate-600">All {values.length} individuals have the same fitness ({formatFitness(min)}).</p>;
  }
  const bins = 10;
  const width = (max - min) / bins;
  const counts = Array.from({ length: bins }, () => 0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - min) / width))]! += 1;
  const peak = Math.max(...counts);
  return (
    <div>
      <div className="flex h-24 items-end gap-1" role="img" aria-label={`Fitness distribution of ${values.length} individuals in the final population`}>
        {counts.map((c, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-teal-600/70"
            style={{ height: `${(c / peak) * 100}%` }}
            title={`${c} individual(s): ${formatFitness(min + i * width)} to ${formatFitness(min + (i + 1) * width)}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{formatFitness(min)}</span>
        <span>{values.length} individuals</span>
        <span>{formatFitness(max)}</span>
      </div>
    </div>
  );
}

function candidateText(c: RankedCandidate): string {
  return c.selections.map((s) => `${s.staple_id}\t${s.is_original ? "original" : `variant ${s.choice}`}\t${s.sequence}`).join("\n");
}

function Ranking({ result }: { result: OptimizationResult }) {
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const cands = result.final_candidates ?? [];
  const top = cands[0];
  const runnerUp = cands[1];
  async function copy(c: RankedCandidate) {
    try {
      await navigator.clipboard.writeText(candidateText(c));
      setCopied("Copied the top candidate's staple sequences.");
    } catch {
      setCopied("Copy failed: the browser blocked clipboard access.");
    }
  }
  if (!top) {
    return (
      <p className="text-xs text-slate-500">
        This result was produced before final-population ranking was recorded, so no ranking is available. New runs include it.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
        Rank 1 has the highest score under <span className="font-mono">{result.fitness_function.name}</span>
        {runnerUp ? (
          <>
            {" "}
            ({formatFitness(top.fitness)} vs {formatFitness(runnerUp.fitness)} for rank 2, Δ {formatFitness(top.fitness - runnerUp.fitness)})
          </>
        ) : null}
        .
        {Object.keys(top.components).length > 0 && (
          <> Components: {Object.entries(top.components).map(([k, v]) => `${k} = ${formatFitness(v)}`).join(", ")}.</>
        )}{" "}
        This only means it scored best on this objective; it is not evidence that the design folds.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2 pr-3">Rank</th>
              <th className="py-2 pr-3">Candidate (genome)</th>
              <th className="py-2 pr-3 text-right">Fitness</th>
              <th className="py-2 pr-3 text-right">Copies</th>
              <th className="py-2 pr-3 text-right">Variants used</th>
              <th className="py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {cands.map((c) => (
              <tr key={c.rank} className={`border-b border-slate-100 align-top last:border-0 ${c.rank === 1 ? "bg-teal-50" : ""}`}>
                <td className="py-2 pr-3 font-semibold">
                  {c.rank}
                  {c.rank === 1 && <span className="ml-1 text-xs font-normal text-teal-800">(selected)</span>}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  [{c.genome.join(", ")}]
                  {open === c.rank && (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {c.selections.map((s) => (
                          <tr key={s.staple_id} className="border-t border-slate-100">
                            <td className="py-0.5 pr-2">{s.staple_id}</td>
                            <td className="py-0.5 pr-2">{s.is_original ? "original" : `variant ${s.choice}`}</td>
                            <td className="py-0.5 break-all">{s.sequence}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatFitness(c.fitness)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{c.occurrences}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{c.selections.filter((s) => !s.is_original).length}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setOpen(open === c.rank ? null : c.rank)}
                      className="rounded border border-slate-300 px-2 py-0.5"
                    >
                      {open === c.rank ? "Hide" : "View details"}
                    </button>
                    {c.rank === 1 && (
                      <button type="button" onClick={() => void copy(c)} className="rounded border border-teal-300 px-2 py-0.5 text-teal-800">
                        Copy sequences
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {copied && (
        <p role="status" className="text-xs text-slate-600">
          {copied}
        </p>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function JobResult({
  jobId,
  onClose,
  status,
  scrollIntoView = false,
}: {
  jobId: string;
  onClose: () => void;
  status?: JobStatus;
  scrollIntoView?: boolean;
}) {
  const active = status === "running" || status === "queued";
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    // Opened by a click: bring the panel (and its chart) into view instead of rendering it off-screen.
    if (scrollIntoView) panel.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [scrollIntoView, jobId]);
  const history = useQuery({
    queryKey: ["jobs", jobId, "history"],
    queryFn: () => api.getJobHistory(jobId),
    refetchInterval: active ? POLL_INTERVAL_MS : false,
  });
  const completed = (history.data?.status ?? status) === "completed";
  const result = useQuery({
    queryKey: ["jobs", jobId, "result"],
    queryFn: () => api.getJobResult(jobId),
    enabled: completed,
    staleTime: Infinity, // results of a completed attempt never change
  });
  const h = history.data?.history ?? [];
  const first = h[0];
  const last = h[h.length - 1];
  const total = history.data?.total_generations ?? null;
  const plateau = plateauLength(h);
  const data = result.data;

  return (
    <section ref={panel} aria-labelledby="result-heading" className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="result-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-800">
          Analysis{data ? `: ${data.design_id}` : ""}
          {history.data && <StatusBadge status={history.data.status} />}
        </h2>
        <div className="flex gap-3 text-sm">
          {completed && (
            <Link to={`/viewer?job=${encodeURIComponent(jobId)}`} className="text-slate-600 underline">
              Open in 3D viewer
            </Link>
          )}
          <button type="button" onClick={onClose} className="text-slate-600 underline">
            Close
          </button>
        </div>
      </div>
      {(history.isPending || (completed && result.isPending)) && <p className="text-sm text-slate-500">Loading…</p>}
      {history.error && <ErrorMessage error={history.error} />}
      {result.error && <ErrorMessage error={result.error} />}

      {history.data && (
        <div className="space-y-5">
          {data && (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>{objectiveLabel(data.fitness_function.name ?? "")}:</strong>{" "}
              <span className="font-mono">{data.fitness_function.name}</span> ({data.fitness_function.kind}). This is a
              computational proxy, not an experimentally validated measure of folding or stability.
              {data.fitness_function.limitations ? <> Limitations: {data.fitness_function.limitations}</> : null}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Card label="Generation" value={last ? `${last.generation} / ${total ?? "—"}` : "—"} />
            <Card label="Initial best" value={formatFitness(first?.best)} />
            <Card label={completed ? "Final best" : "Current best"} value={formatFitness(last?.best)} />
            <Card label={completed ? "Final mean" : "Current mean"} value={formatFitness(last?.mean)} />
            <Card label="Improvement" value={first && last ? formatFitness(last.best - first.best) : "—"} />
            <Card label="Best unchanged for" value={h.length ? `${plateau} gen.` : "—"} />
            <Card label="Distinct designs scored" value={data?.unique_evaluations ? String(data.unique_evaluations) : "—"} />
          </dl>
          <p className="text-xs text-slate-500">
            {history.data.source === "result" && "Recorded GA values from the stored result."}
            {history.data.source === "live" && `Recorded so far by the worker (${history.data.status}).`}
            {history.data.source === "unavailable" &&
              `${history.data.note ?? ""} No graph can be shown for it; run a new optimization to record generation history.`}
            {h.length > 0 &&
              (plateau === h.length
                ? " The best was already in the initial population and never changed (common for small search spaces)."
                : ` Convergence: best unchanged for the last ${plateau} recorded generation(s).`)}
          </p>

          {h.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-700">Fitness by generation</h3>
              <GenerationChart history={h} total={total} />
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-slate-600">Show values</summary>
                <div className="max-h-56 overflow-auto">
                  <table className="w-full text-left tabular-nums">
                    <thead className="sticky top-0 bg-white text-slate-500">
                      <tr>
                        <th className="py-1 pr-4">Generation</th>
                        <th className="py-1 pr-4">Best</th>
                        <th className="py-1">Mean</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.map((g) => (
                        <tr key={g.generation}>
                          <td className="py-0.5 pr-4">{g.generation}</td>
                          <td className="py-0.5 pr-4">{formatFitness(g.best)}</td>
                          <td className="py-0.5">{formatFitness(g.mean)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}

          {data && (
            <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
              <div>
                <h3 className="mb-1 text-sm font-semibold text-slate-700">Final population ranking</h3>
                <Ranking result={data} />
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold text-slate-700">Fitness distribution (final population)</h3>
                {data.final_population_fitness?.length ? (
                  <Distribution values={data.final_population_fitness} />
                ) : (
                  <p className="text-xs text-slate-500">Not recorded for this (older) result.</p>
                )}
              </div>
            </div>
          )}
          {!completed && history.data.status !== "queued" && (
            <p className="text-xs text-slate-500">Ranking and distribution are available once the job completes.</p>
          )}
        </div>
      )}
    </section>
  );
}
