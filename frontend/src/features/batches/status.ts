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
