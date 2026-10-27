import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { api, type BatchOut, type JobOut, type JobPage } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { StatusBadge } from "../../components/StatusBadge";
import { useToken } from "../../components/TokenContext";
import { formatDate } from "../../lib/format";
import { FitnessValue } from "./FitnessValue";
import { JobResult } from "./JobResult";
import {
  bestFitness,
  canCancelJob,
  canRetryJob,
  GA_DEFAULTS,
  isBatchActive,
  isJobActive,
  POLL_INTERVAL_MS,
} from "./status";

function Progress({ job }: { job: JobOut }) {
  const generation = typeof job.progress?.generation === "number" ? job.progress.generation : undefined;
  const total = typeof job.progress?.total === "number" ? job.progress.total : undefined;
  if (generation === undefined || !total) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex min-w-28 items-center gap-2">
      <progress className="h-1.5 w-20" value={generation} max={total} aria-label={`Generation ${generation} of ${total}`} />
      <span className="tabular-nums text-xs">
        {generation}/{total}
      </span>
    </div>
  );
}

/** The method a job actually ran (from its result) or, before it finishes, the one requested. */
function methodLabel(job: JobOut): string {
  const used = job.result?.method;
  if (used === "exhaustive") return "exhaustive";
  if (used === "ga") return "GA";
  return job.method === "auto" ? "auto" : job.method === "exhaustive" ? "exhaustive" : "GA";
}

export function BatchDetail() {
  const { batchId = "" } = useParams();
  const { token } = useToken();
  const queryClient = useQueryClient();
  // The analysis panel's job lives in the URL (?job=...), so it survives a page refresh. Without a choice,
  // the first completed job is shown so the generation chart is visible straight away; ?job=none = closed.
  const [params, setParams] = useSearchParams();
  const [scrollToPanel, setScrollToPanel] = useState(false);

  const batchKey = ["batches", batchId];
  const jobsKey = ["batches", batchId, "jobs"];
  // Poll while the batch or any of its jobs is still active; stop once everything is final.
  // React Query never overlaps fetches of one query and stops polling when the page unmounts.
  const pollInterval = () => {
    const b = queryClient.getQueryData<BatchOut>(batchKey);
    const j = queryClient.getQueryData<JobPage>(jobsKey);
    return (b && isBatchActive(b)) || j?.items.some(isJobActive) ? POLL_INTERVAL_MS : false;
  };
  const batch = useQuery({
    queryKey: batchKey,
    queryFn: () => api.getBatch(batchId),
    enabled: Boolean(token),
    refetchInterval: pollInterval,
  });
  const jobs = useQuery({
    queryKey: jobsKey,
    queryFn: () => api.listBatchJobs(batchId),
    enabled: Boolean(token),
    refetchInterval: pollInterval,
  });
  const active = Boolean((batch.data && isBatchActive(batch.data)) || jobs.data?.items.some(isJobActive));
  const chosen = params.get("job");
  const resultJobId =
    chosen === "none" ? null : (chosen ?? jobs.data?.items.find((j) => j.status === "completed")?.id ?? null);
  const openAnalysis = (id: string | null) => {
    setScrollToPanel(id !== null);
    setParams(id ? { job: id } : { job: "none" }, { replace: true });
  };

  // A job finishing changes the batch counts: refresh the list view too.
  const finished = batch.data && !isBatchActive(batch.data);
  useEffect(() => {
    if (finished) void queryClient.invalidateQueries({ queryKey: ["batches", "list"] });
  }, [finished, queryClient]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["batches", batchId] });
  const cancelBatch = useMutation({ mutationFn: () => api.cancelBatch(batchId), onSettled: refresh });
  const cancelJob = useMutation({ mutationFn: (id: string) => api.cancelJob(id), onSettled: refresh });
  const retryJob = useMutation({ mutationFn: (id: string) => api.retryJob(id), onSettled: refresh });
  const actionError = cancelBatch.error ?? cancelJob.error ?? retryJob.error;
  const busy = cancelBatch.isPending || cancelJob.isPending || retryJob.isPending;

  if (!token) return <p className="text-sm text-slate-500">Set an API token in the header.</p>;
  if (batch.error) return <ErrorMessage error={batch.error} />;
  if (!batch.data) return <p className="text-sm text-slate-500">Loading…</p>;

  const b = batch.data;
  const counts: [string, number | undefined][] = [
    ["Queued", b.counts.queued],
    ["Running", b.counts.running],
    ["Completed", b.counts.completed],
    ["Failed", b.counts.failed],
    ["Cancelled", b.counts.cancelled],
  ];

  return (
    <div className="space-y-6">
      <nav className="text-sm">
        <Link to="/batches" className="text-slate-500 hover:text-slate-800">
          ← Batches
        </Link>
      </nav>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{b.name ?? "Unnamed batch"}</h2>
            <p className="font-mono text-xs text-slate-500">{b.id}</p>
          </div>
          <StatusBadge status={b.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
          <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">Jobs</dt>
            <dd className="text-lg font-semibold tabular-nums">{b.total_jobs}</dd>
          </div>
          {counts.map(([label, value]) => (
            <div key={label} className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          Created {formatDate(b.created_at)}
          {b.finished_at ? ` · finished ${formatDate(b.finished_at)}` : ""} · seed {String(b.params.seed ?? "—")} ·
          fitness <span className="font-mono">{b.fitness.name}</span> ({b.fitness.kind}) · method{" "}
          <span className="font-mono">{b.method}</span>
        </p>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="GA settings used">
          {(Object.keys(GA_DEFAULTS) as (keyof typeof GA_DEFAULTS)[]).map((k) => (
            <div key={k} className="flex gap-1">
              <dt className="text-slate-500">{k.replaceAll("_", " ")}</dt>
              <dd className="tabular-nums">
                {String(b.params[k] ?? "—")}
                {b.params[k] !== undefined && b.params[k] !== GA_DEFAULTS[k] ? " (custom)" : ""}
              </dd>
            </div>
          ))}
        </dl>
        {b.method !== "ga" && (
          <p className="mt-1 text-xs text-slate-500">
            GA settings apply only to jobs that ran the GA; each job&apos;s method is shown below.
          </p>
        )}
        {active && <p className="mt-2 text-sm text-sky-800">Jobs are running; this page updates automatically.</p>}
        <div className="mt-4">
          <button
            type="button"
            disabled={!isBatchActive(b) || busy}
            onClick={() => {
              if (window.confirm("Cancel all unfinished jobs in this batch?")) cancelBatch.mutate();
            }}
            className="rounded border border-red-200 px-3 py-1 text-sm text-red-700 disabled:opacity-40"
          >
            Cancel batch
          </button>
        </div>
      </section>

      {actionError && <ErrorMessage error={actionError} />}

      <section aria-labelledby="jobs-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 id="jobs-heading" className="mb-3 text-lg font-semibold text-slate-800">
          Jobs
        </h2>
        {jobs.isPending && <p className="text-sm text-slate-500">Loading jobs…</p>}
        {jobs.error && <ErrorMessage error={jobs.error} />}
        {jobs.data && jobs.data.items.length === 0 && <p className="text-sm text-slate-500">No jobs.</p>}
        {jobs.data && jobs.data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Design</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Method</th>
                  <th className="py-2 pr-4">Progress</th>
                  <th className="py-2 pr-4 text-right">Best fitness</th>
                  <th className="py-2 pr-4 text-right">Attempt</th>
                  <th className="py-2 pr-4">Error</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.data.items.map((job) => (
                  <tr key={job.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{job.external_id ?? job.design_id ?? job.id}</td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={job.status} />
                      {job.cancel_requested && isJobActive(job) && (
                        <span className="ml-1 text-xs text-slate-500">cancelling…</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs">{methodLabel(job)}</td>
                    <td className="py-2 pr-4">
                      <Progress job={job} />
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      <FitnessValue
                        fitness={job.fitness}
                        score={bestFitness(job)}
                        components={job.result?.best_components as Record<string, unknown> | undefined}
                      />
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{job.attempt}</td>
                    <td className="py-2 pr-4 text-xs text-red-800">
                      {job.error ? String(job.error.message ?? job.error.code ?? "Failed") : ""}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <button
                          type="button"
                          disabled={job.status === "queued"}
                          onClick={() => openAnalysis(job.id)}
                          className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
                        >
                          {job.status === "completed" ? "View result" : "View progress"}
                        </button>
                        <button
                          type="button"
                          disabled={!canCancelJob(job) || busy}
                          onClick={() => cancelJob.mutate(job.id)}
                          className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={!canRetryJob(job) || busy}
                          onClick={() => retryJob.mutate(job.id)}
                          className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
                        >
                          Retry
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {jobs.data?.next_cursor && (
          <p className="mt-2 text-xs text-slate-500">Showing the first {jobs.data.items.length} jobs.</p>
        )}
      </section>

      {resultJobId && (
        <JobResult
          key={resultJobId}
          jobId={resultJobId}
          status={jobs.data?.items.find((j) => j.id === resultJobId)?.status}
          fitness={jobs.data?.items.find((j) => j.id === resultJobId)?.fitness ?? b.fitness.name}
          scrollIntoView={scrollToPanel}
          onClose={() => openAnalysis(null)}
        />
      )}
    </div>
  );
}
