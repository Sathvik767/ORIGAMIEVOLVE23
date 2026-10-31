import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  ChartLine,
  CircleCheck,
  CircleStop,
  CircleX,
  Clock,
  Eye,
  KeyRound,
  Layers,
  ListTree,
  LoaderCircle,
  OctagonX,
  RotateCw,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { api, type BatchOut, type JobOut, type JobPage } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { StatusBadge } from "../../components/StatusBadge";
import { useToken } from "../../components/TokenContext";
import type { Tone } from "../../components/ui/Badge";
import { Button, IconButton } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState, LoadingBlock, PageHeader, ProgressBar } from "../../components/ui/Feedback";
import { RelativeTime } from "../../components/ui/RelativeTime";
import { StatCard } from "../../components/ui/StatCard";
import { Table } from "../../components/ui/Table";
import { useToast } from "../../components/ui/Toast";
import { cx } from "../../lib/cx";
import { formatCount } from "../../lib/format";
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
  if (generation === undefined || !total) return <span className="text-subtle">—</span>;
  return (
    <div className="flex min-w-32 items-center gap-2">
      <ProgressBar
        className="w-20"
        value={generation}
        max={total}
        label={`Generation ${generation} of ${total}`}
        tone={job.status === "completed" ? "success" : "primary"}
      />
      <span className="font-mono text-xs text-muted">
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
  const toast = useToast();
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
  const cancelBatch = useMutation({
    mutationFn: () => api.cancelBatch(batchId),
    onSuccess: () => toast("Cancellation requested for unfinished jobs"),
    onSettled: refresh,
  });
  const cancelJob = useMutation({
    mutationFn: (id: string) => api.cancelJob(id),
    onSuccess: () => toast("Job cancelled"),
    onSettled: refresh,
  });
  const retryJob = useMutation({
    mutationFn: (id: string) => api.retryJob(id),
    onSuccess: () => toast("Job queued for retry"),
    onSettled: refresh,
  });
  const actionError = cancelBatch.error ?? cancelJob.error ?? retryJob.error;
  const busy = cancelBatch.isPending || cancelJob.isPending || retryJob.isPending;

  if (!token) return <EmptyState icon={<KeyRound className="size-5" />} title="Set an API token in the sidebar." />;
  if (batch.error) return <ErrorMessage error={batch.error} onRetry={() => void batch.refetch()} />;
  if (!batch.data) return <LoadingBlock label="Loading batch…" rows={6} />;

  const b = batch.data;
  const doneJobs = (b.counts.completed ?? 0) + (b.counts.failed ?? 0) + (b.counts.cancelled ?? 0);
  const counts: { label: string; value: number | undefined; tone: Tone; icon: ReactNode }[] = [
    { label: "Queued", value: b.counts.queued, tone: "neutral", icon: <Clock className="size-4" /> },
    { label: "Running", value: b.counts.running, tone: "info", icon: <LoaderCircle className="size-4" /> },
    { label: "Completed", value: b.counts.completed, tone: "success", icon: <CircleCheck className="size-4" /> },
    { label: "Failed", value: b.counts.failed, tone: "danger", icon: <CircleX className="size-4" /> },
    { label: "Cancelled", value: b.counts.cancelled, tone: "neutral", icon: <Ban className="size-4" /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Batch"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {b.name ?? "Unnamed batch"} <StatusBadge status={b.status} />
          </span>
        }
        description={<span className="font-mono text-xs">{b.id}</span>}
        actions={
          <Button
            variant="danger"
            icon={<OctagonX aria-hidden className="size-4" />}
            disabled={!isBatchActive(b) || busy}
            onClick={() => {
              if (window.confirm("Cancel all unfinished jobs in this batch?")) cancelBatch.mutate();
            }}
          >
            Cancel batch
          </Button>
        }
      />

      <Card>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Jobs" value={formatCount(b.total_jobs)} icon={<Layers className="size-4" />} tone="primary" />
          {counts.map((c) => (
            <StatCard key={c.label} label={c.label} value={formatCount(c.value)} icon={c.icon} tone={c.value ? c.tone : "neutral"} />
          ))}
        </dl>
        <div className="mt-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Batch progress</span>
            <span className="font-mono">
              {formatCount(doneJobs)} / {formatCount(b.total_jobs)} finished
            </span>
          </div>
          <ProgressBar
            label={`${doneJobs} of ${b.total_jobs} jobs finished`}
            value={doneJobs}
            max={b.total_jobs}
            className="h-2"
            segments={[
              { value: b.counts.completed ?? 0, tone: "success" },
              { value: b.counts.failed ?? 0, tone: "danger" },
              { value: b.counts.cancelled ?? 0, tone: "neutral" },
            ]}
          />
        </div>
        {active && (
          <p className="mt-3 flex items-center gap-2 text-sm text-info">
            <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
            Jobs are running; this page updates automatically.
          </p>
        )}
        <div className="mt-5 grid gap-4 border-t border-border pt-4 lg:grid-cols-[1fr_auto]">
          <p className="text-xs text-muted">
            Created <RelativeTime iso={b.created_at} />
            {b.finished_at ? (
              <>
                {" "}· finished <RelativeTime iso={b.finished_at} />
              </>
            ) : null}{" "}
            · seed <span className="font-mono">{String(b.params.seed ?? "—")}</span> · fitness{" "}
            <span className="font-mono">{b.fitness.name}</span> ({b.fitness.kind}) · method{" "}
            <span className="font-mono">{b.method}</span>
          </p>
        </div>
        <dl className="mt-2 flex flex-wrap gap-2 text-xs" aria-label="GA settings used">
          {(Object.keys(GA_DEFAULTS) as (keyof typeof GA_DEFAULTS)[]).map((k) => {
            const custom = b.params[k] !== undefined && b.params[k] !== GA_DEFAULTS[k];
            return (
              <div
                key={k}
                className={cx(
                  "flex gap-1.5 rounded-md border px-2 py-1",
                  custom ? "border-primary/35 bg-primary-soft" : "border-border bg-surface-raised/60",
                )}
              >
                <dt className="text-muted">{k.replaceAll("_", " ")}</dt>
                <dd className={cx("font-mono", custom ? "text-primary" : "text-fg")}>
                  {String(b.params[k] ?? "—")}
                  {custom ? " (custom)" : ""}
                </dd>
              </div>
            );
          })}
        </dl>
        {b.method !== "ga" && (
          <p className="mt-2 text-xs text-subtle">GA settings apply only to jobs that ran the GA; each job&apos;s method is shown below.</p>
        )}
      </Card>

      {actionError && <ErrorMessage error={actionError} />}

      <Card title="Jobs" icon={<ListTree className="size-4" />}>
        {jobs.isPending && <LoadingBlock label="Loading jobs…" rows={4} />}
        {jobs.error && <ErrorMessage error={jobs.error} onRetry={() => void jobs.refetch()} />}
        {jobs.data && jobs.data.items.length === 0 && <EmptyState icon={<ListTree className="size-5" />} title="No jobs." />}
        {jobs.data && jobs.data.items.length > 0 && (
          <Table>
            <table>
              <thead>
                <tr>
                  <th>Design</th>
                  <th>Status</th>
                  <th>Method</th>
                  <th>Progress</th>
                  <th className="text-right">Best fitness</th>
                  <th className="text-right">Attempt</th>
                  <th>Error</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.data.items.map((job) => (
                  <tr key={job.id} className={cx(job.id === resultJobId && "bg-primary-soft/60")}>
                    <td className="font-mono text-xs whitespace-nowrap">{job.external_id ?? job.design_id ?? job.id}</td>
                    <td className="whitespace-nowrap">
                      <StatusBadge status={job.status} />
                      {job.cancel_requested && isJobActive(job) && <span className="ml-1 text-xs text-muted">cancelling…</span>}
                    </td>
                    <td className="font-mono text-xs text-muted">{methodLabel(job)}</td>
                    <td>
                      <Progress job={job} />
                    </td>
                    <td className="text-right">
                      <FitnessValue
                        fitness={job.fitness}
                        score={bestFitness(job)}
                        components={job.result?.best_components as Record<string, unknown> | undefined}
                      />
                    </td>
                    <td className="text-right font-mono">{job.attempt}</td>
                    <td className="max-w-64 text-xs text-danger">
                      {job.error ? String(job.error.message ?? job.error.code ?? "Failed") : ""}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <IconButton
                          label={job.status === "completed" ? "View result" : "View progress"}
                          icon={job.status === "completed" ? <ChartLine aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
                          disabled={job.status === "queued"}
                          onClick={() => openAnalysis(job.id)}
                        />
                        <IconButton
                          label="Cancel"
                          icon={<CircleStop aria-hidden className="size-4" />}
                          disabled={!canCancelJob(job) || busy}
                          onClick={() => cancelJob.mutate(job.id)}
                        />
                        <IconButton
                          label="Retry"
                          icon={<RotateCw aria-hidden className="size-4" />}
                          disabled={!canRetryJob(job) || busy}
                          onClick={() => retryJob.mutate(job.id)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Table>
        )}
        {jobs.data?.next_cursor && <p className="mt-2 text-xs text-muted">Showing the first {jobs.data.items.length} jobs.</p>}
      </Card>

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
      <Link to="/batches" className="text-sm text-muted hover:text-fg">
        ← Batches
      </Link>
    </div>
  );
}
