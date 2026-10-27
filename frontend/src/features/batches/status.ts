import type { BatchOut, JobOut } from "../../api/client";

/** How often an active batch and its jobs are refreshed. Polling stops when nothing is active. */
export const POLL_INTERVAL_MS = 2000;

export function isBatchActive(batch: Pick<BatchOut, "status">): boolean {
  return batch.status === "queued" || batch.status === "running";
}

export function isJobActive(job: Pick<JobOut, "status">): boolean {
  return job.status === "queued" || job.status === "running";
}

/** Mirrors the API: queued jobs cancel immediately, running jobs get a cancel request (once). */
export function canCancelJob(job: JobOut): boolean {
  return isJobActive(job) && !job.cancel_requested;
}

export function canRetryJob(job: JobOut): boolean {
  return job.status === "failed" || job.status === "cancelled";
}

export function bestFitness(job: JobOut): number | undefined {
  const fromResult = job.result?.best_fitness;
  if (typeof fromResult === "number") return fromResult;
  const fromProgress = job.progress?.best_fitness;
  return typeof fromProgress === "number" ? fromProgress : undefined;
}

export function formatFitness(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(6);
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** GA defaults (mirrors GAParameters on the server); a batch may override them within server limits. */
export const GA_DEFAULTS = {
  population_size: 50,
  generations: 100,
  mutation_rate: 0.05,
  crossover_rate: 0.8,
  elitism: 2,
  tournament_size: 3,
} as const;
export type GASettings = { -readonly [K in keyof typeof GA_DEFAULTS]: number };

export const DEMO_OBJECTIVE = "synthetic_gc_balance_demo";

/**
 * The demo objective stores score = -(mean GC deviation). For display only, return that deviation
 * (lower is better): from best_components when recorded, otherwise -score (exact by definition).
 * Returns undefined for every other objective, whose scores are shown as stored.
 */
export function demoDeviation(
  fitness: string | null | undefined,
  score: number | undefined,
  components?: Record<string, unknown> | null,
): number | undefined {
  if (fitness !== DEMO_OBJECTIVE || score === undefined) return undefined;
  const recorded = components?.mean_gc_deviation;
  return typeof recorded === "number" ? recorded : -score;
}
