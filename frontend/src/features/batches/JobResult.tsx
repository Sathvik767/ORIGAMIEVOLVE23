import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChartLine,
  ChartNoAxesColumn,
  Copy,
  Cpu,
  FlaskConical,
  Gauge,
  Hash,
  Orbit,
  Repeat,
  Sigma,
  Target,
  TrendingUp,
  Trophy,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router";

import { api, type GenerationPoint, type JobStatus, type OptimizationResult, type RankedCandidate } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { StatusBadge } from "../../components/StatusBadge";
import { Button, buttonClass } from "../../components/ui/Button";
import { cardClass } from "../../components/ui/Card";
import { Callout, LoadingBlock } from "../../components/ui/Feedback";
import { StatCard } from "../../components/ui/StatCard";
import { Table } from "../../components/ui/Table";
import { useToast } from "../../components/ui/Toast";
import { cx } from "../../lib/cx";
import { FitnessValue } from "./FitnessValue";
import { DEMO_OBJECTIVE, demoDeviation, formatFitness, fullFitness, POLL_INTERVAL_MS } from "./status";

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

function LegendChip({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised/60 px-2.5 py-0.5">
      {swatch}
      {children}
    </span>
  );
}

/** Interactive line chart of recorded best and mean fitness per generation (dependency-free SVG, theme colours). */
function GenerationChart({
  history,
  total,
  fitness,
}: {
  history: GenerationPoint[];
  total: number | null;
  fitness: string | null | undefined;
}) {
  const [hover, setHover] = useState<GenerationPoint | null>(null);
  if (history.length < 2) {
    return <p className="text-xs text-muted">The chart appears once at least two generations are recorded.</p>;
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
  const area = `${x(history[0]!.generation)},${H - B} ${line("best")} ${x(history[history.length - 1]!.generation)},${H - B}`;
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
          className="h-auto max-h-[26rem] w-full rounded-lg border border-border bg-surface-sunken"
          role="img"
          aria-label={`Best and mean fitness over ${history.length} recorded generations`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="oe-best-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={W - R} y1={y(min + f * span)} y2={y(min + f * span)} stroke="var(--color-border)" strokeDasharray={f === 0 ? undefined : "2 4"} />
              {f % 0.5 === 0 && (
                <text x={L - 6} y={y(min + f * span) + 4} textAnchor="end" fontSize="10" fill="var(--color-muted)" fontFamily="var(--font-mono)">
                  {formatFitness(min + f * span)}
                </text>
              )}
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={f} x={x(f * lastGen)} y={H - 22} textAnchor="middle" fontSize="10" fill="var(--color-muted)" fontFamily="var(--font-mono)">
              {Math.round(f * lastGen)}
            </text>
          ))}
          <text x={L + (W - L - R) / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-fg)">
            Generation
          </text>
          <text
            x={12}
            y={T + (H - T - B) / 2}
            textAnchor="middle"
            fontSize="11"
            fill="var(--color-fg)"
            transform={`rotate(-90 12 ${T + (H - T - B) / 2})`}
          >
            Fitness
          </text>
          <polygon points={area} fill="url(#oe-best-fill)" />
          <polyline points={line("mean")} fill="none" stroke="var(--color-subtle)" strokeWidth="2" strokeDasharray="5 4" data-series="mean" />
          <polyline points={line("best")} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinejoin="round" data-series="best" />
          {hover && (
            <g>
              <line x1={x(hover.generation)} x2={x(hover.generation)} y1={T} y2={H - B} stroke="var(--color-border-strong)" />
              <circle cx={x(hover.generation)} cy={y(hover.best)} r="4.5" fill="var(--color-primary)" stroke="var(--color-surface)" strokeWidth="2" />
              <circle cx={x(hover.generation)} cy={y(hover.mean)} r="3.5" fill="var(--color-subtle)" stroke="var(--color-surface)" strokeWidth="2" />
            </g>
          )}
        </svg>
        {hover && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-2 right-2 rounded-md border border-border bg-surface-raised/95 px-2.5 py-1.5 font-mono text-xs text-fg shadow-[var(--shadow-raised)]"
          >
            Generation {hover.generation} · best {formatFitness(hover.best)} · mean {formatFitness(hover.mean)}
            {fitness === DEMO_OBJECTIVE && (
              <div className="text-muted">
                mean GC deviation: best {formatFitness(demoDeviation(fitness, hover.best))} · mean{" "}
                {formatFitness(demoDeviation(fitness, hover.mean))} (lower is better)
              </div>
            )}
          </div>
        )}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <LegendChip swatch={<span aria-hidden className="inline-block h-0.5 w-4 rounded bg-primary" />}>best fitness</LegendChip>
        <LegendChip swatch={<span aria-hidden className="inline-block w-4 border-t-2 border-dashed border-subtle" />}>
          average (mean) fitness
        </LegendChip>
        <span className="text-subtle">x: generation · hover for values</span>
      </figcaption>
    </figure>
  );
}

function Distribution({ values }: { values: number[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return <p className="text-xs text-muted">All {values.length} individuals have the same fitness ({formatFitness(min)}).</p>;
  }
  const bins = 10;
  const width = (max - min) / bins;
  const counts = Array.from({ length: bins }, () => 0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - min) / width))]! += 1;
  const peak = Math.max(...counts);
  const label = (i: number) => `${counts[i]} individual(s): ${formatFitness(min + i * width)} to ${formatFitness(min + (i + 1) * width)}`;
  return (
    <div>
      <div
        className="flex h-28 items-end gap-1 rounded-lg border border-border bg-surface-sunken p-2"
        role="img"
        aria-label={`Fitness distribution of ${values.length} individuals in the final population`}
        onMouseLeave={() => setHovered(null)}
      >
        {counts.map((c, i) => (
          <div
            key={i}
            className={cx(
              "flex-1 rounded-t transition-colors duration-150",
              hovered === i ? "bg-primary" : "bg-primary-strong/60",
              c === 0 && "bg-border",
            )}
            style={{ height: `${Math.max((c / peak) * 100, c ? 4 : 2)}%` }}
            title={label(i)}
            onMouseEnter={() => setHovered(i)}
          />
        ))}
      </div>
      <p aria-hidden className="mt-1 h-4 text-center font-mono text-xs text-fg">
        {hovered !== null ? label(hovered) : ""}
      </p>
      <div className="flex justify-between font-mono text-xs text-muted">
        <span>{formatFitness(min)}</span>
        <span className="font-sans">{values.length} individuals</span>
        <span>{formatFitness(max)}</span>
      </div>
    </div>
  );
}

function candidateText(c: RankedCandidate): string {
  return c.selections.map((s) => `${s.staple_id}\t${s.is_original ? "original" : `variant ${s.choice}`}\t${s.sequence}`).join("\n");
}

function Ranking({ result }: { result: OptimizationResult }) {
  const toast = useToast();
  const [open, setOpen] = useState<number | null>(null);
  const cands = result.final_candidates ?? [];
  const top = cands[0];
  const runnerUp = cands[1];
  async function copy(c: RankedCandidate) {
    try {
      await navigator.clipboard.writeText(candidateText(c));
      toast("Copied the top candidate's staple sequences.");
    } catch {
      toast("Copy failed: the browser blocked clipboard access.", "error");
    }
  }
  if (!top) {
    return (
      <p className="text-xs text-muted">
        This result was produced before final-population ranking was recorded, so no ranking is available. New runs include it.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {result.method === "exhaustive" ? "Top candidates among all scored combinations. " : "Distinct candidates in the final GA population. "}
        Rank 1 has the highest score under <span className="font-mono text-fg">{result.fitness_function.name}</span>
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
      <Table>
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Candidate (genome)</th>
              <th className="text-right">Fitness</th>
              {result.method !== "exhaustive" && <th className="text-right">Copies</th>}
              <th className="text-right">Variants used</th>
              <th className="text-right">Details</th>
            </tr>
          </thead>
          <tbody>
            {cands.map((c) => (
              <tr key={c.rank} className={cx("align-top", c.rank === 1 && "bg-primary-soft [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-primary)]")}>
                <td className="pl-2! font-semibold whitespace-nowrap">
                  {c.rank === 1 && <Trophy aria-hidden className="mr-1 inline size-3.5 text-accent" />}
                  {c.rank}
                  {c.rank === 1 && <span className="ml-1 text-xs font-normal text-primary">(selected)</span>}
                </td>
                <td className="font-mono text-xs">
                  [{c.genome.join(", ")}]
                  {open === c.rank && (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {c.selections.map((s) => (
                          <tr key={s.staple_id} className="border-t border-border/60">
                            <td className="py-0.5 pr-2">{s.staple_id}</td>
                            <td className="py-0.5 pr-2 font-sans text-muted">{s.is_original ? "original" : `variant ${s.choice}`}</td>
                            <td className="py-0.5 break-all">{s.sequence}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </td>
                <td className="text-right">
                  <FitnessValue fitness={result.fitness_function.name} score={c.fitness} components={c.components} />
                </td>
                {result.method !== "exhaustive" && <td className="text-right font-mono">{c.occurrences}</td>}
                <td className="text-right font-mono">{c.selections.filter((s) => !s.is_original).length}</td>
                <td>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setOpen(open === c.rank ? null : c.rank)}>
                      {open === c.rank ? "Hide" : "View details"}
                    </Button>
                    {c.rank === 1 && (
                      <Button size="sm" variant="secondary" icon={<Copy aria-hidden className="size-3.5" />} onClick={() => void copy(c)}>
                        Copy sequences
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Table>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
        <span aria-hidden className="text-primary">
          {icon}
        </span>
        {title}
      </h3>
      {children}
    </div>
  );
}

export function JobResult({
  jobId,
  onClose,
  status,
  fitness,
  scrollIntoView = false,
}: {
  jobId: string;
  onClose: () => void;
  status?: JobStatus;
  /** Objective name from the job, so scores can be labelled before the full result is loaded. */
  fitness?: string | null;
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
  const objectiveName = data?.fitness_function.name ?? fitness;
  const exhaustive = data?.method === "exhaustive";
  const score = (value: number | undefined, components?: Record<string, unknown> | null) => (
    <FitnessValue fitness={objectiveName} score={value} components={components} />
  );

  return (
    <section ref={panel} aria-labelledby="result-heading" className={cx(cardClass, "scroll-mt-20")}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 id="result-heading" className="flex flex-wrap items-center gap-2 text-base font-semibold text-fg">
          <ChartLine aria-hidden className="size-4 text-primary" />
          Analysis{data ? `: ${data.design_id}` : ""}
          {history.data && <StatusBadge status={history.data.status} />}
        </h2>
        <div className="flex gap-2">
          {completed && (
            <Link to={`/viewer?job=${encodeURIComponent(jobId)}`} className={buttonClass("secondary", "sm")}>
              <Orbit aria-hidden className="size-3.5" />
              Open in 3D viewer
            </Link>
          )}
          <Button size="sm" variant="ghost" icon={<X aria-hidden className="size-3.5" />} onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <div className="space-y-6 p-5">
        {(history.isPending || (completed && result.isPending)) && <LoadingBlock label="Loading analysis…" rows={5} />}
        {history.error && <ErrorMessage error={history.error} onRetry={() => void history.refetch()} />}
        {result.error && <ErrorMessage error={result.error} onRetry={() => void result.refetch()} />}

        {history.data && (
          <>
            {data && (
              <Callout tone="warning" icon={<FlaskConical />} className="text-xs">
                <strong>{objectiveLabel(data.fitness_function.name ?? "")}:</strong>{" "}
                <span className="font-mono">{data.fitness_function.name}</span> ({data.fitness_function.kind}). This is a computational
                proxy, not an experimentally validated measure of folding or stability.
                {data.fitness_function.limitations ? <> Limitations: {data.fitness_function.limitations}</> : null}
              </Callout>
            )}

            {exhaustive && data ? (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatCard label="Method" value="Exhaustive search" icon={<Cpu className="size-4" />} tone="info" />
                <StatCard label="Best" value={score(data.best_fitness, data.best_components)} icon={<Trophy className="size-4" />} tone="primary" />
                <StatCard label="Combinations scored" value={String(data.unique_evaluations)} icon={<Hash className="size-4" />} />
              </dl>
            ) : (
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="Method" value={data ? "Genetic algorithm" : "—"} icon={<Cpu className="size-4" />} tone="info" />
                <StatCard label="Generation" value={last ? `${last.generation} / ${total ?? "—"}` : "—"} icon={<Activity className="size-4" />} />
                <StatCard label="Initial best" value={score(first?.best)} icon={<Target className="size-4" />} />
                <StatCard
                  label={completed ? "Final best" : "Current best"}
                  value={score(last?.best, completed && data?.best_fitness === last?.best ? data?.best_components : null)}
                  icon={<Trophy className="size-4" />}
                  tone="primary"
                />
                <StatCard label={completed ? "Final mean" : "Current mean"} value={score(last?.mean)} icon={<Sigma className="size-4" />} />
                <StatCard
                  label="Improvement"
                  value={first && last ? <span title={fullFitness(last.best - first.best)}>{formatFitness(last.best - first.best)}</span> : "—"}
                  icon={<TrendingUp className="size-4" />}
                  tone={first && last && last.best > first.best ? "success" : "neutral"}
                />
                <StatCard label="Best unchanged for" value={h.length ? `${plateau} gen.` : "—"} icon={<Repeat className="size-4" />} />
                <StatCard
                  label="Distinct designs scored"
                  value={data?.unique_evaluations ? String(data.unique_evaluations) : "—"}
                  icon={<Gauge className="size-4" />}
                />
              </dl>
            )}
            <p className="text-xs text-muted">
              {exhaustive && (data?.note ?? "Exhaustive search: no GA generations were run, so there is no generation chart.")}
              {!exhaustive && history.data.source === "result" && "Recorded GA values from the stored result."}
              {history.data.source === "live" && `Recorded so far by the worker (${history.data.status}).`}
              {history.data.source === "unavailable" &&
                `${history.data.note ?? ""} No graph can be shown for it; run a new optimization to record generation history.`}
              {h.length > 0 &&
                (plateau === h.length
                  ? " The best was already in the initial population and never changed (common for small search spaces)."
                  : ` Convergence: best unchanged for the last ${plateau} recorded generation(s).`)}
            </p>

            {h.length > 0 && (
              <Section title="Fitness by generation" icon={<ChartLine className="size-4" />}>
                <GenerationChart history={h} total={total} fitness={objectiveName} />
                <details className="group mt-3 text-xs">
                  <summary className="cursor-pointer text-muted transition-colors hover:text-fg">Show values</summary>
                  <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-left font-mono">
                      <thead className="sticky top-0 bg-surface text-muted">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">Generation</th>
                          <th className="px-3 py-1.5 font-medium">Best</th>
                          <th className="px-3 py-1.5 font-medium">Mean</th>
                        </tr>
                      </thead>
                      <tbody>
                        {h.map((g) => (
                          <tr key={g.generation} className="border-t border-border/50">
                            <td className="px-3 py-0.5">{g.generation}</td>
                            <td className="px-3 py-0.5" title={fullFitness(g.best)}>
                              {formatFitness(g.best)}
                            </td>
                            <td className="px-3 py-0.5" title={fullFitness(g.mean)}>
                              {formatFitness(g.mean)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </Section>
            )}

            {data && (
              <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                <Section title={exhaustive ? "Candidate ranking (all combinations)" : "Final population ranking"} icon={<Trophy className="size-4" />}>
                  <Ranking result={data} />
                </Section>
                <Section title="Fitness distribution (final population)" icon={<ChartNoAxesColumn className="size-4" />}>
                  {data.final_population_fitness?.length ? (
                    <Distribution values={data.final_population_fitness} />
                  ) : (
                    <p className="text-xs text-muted">
                      {exhaustive ? "Not applicable: exhaustive search has no population." : "Not recorded for this (older) result."}
                    </p>
                  )}
                </Section>
              </div>
            )}
            {!completed && history.data.status !== "queued" && (
              <p className="text-xs text-muted">Ranking and distribution are available once the job completes.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
