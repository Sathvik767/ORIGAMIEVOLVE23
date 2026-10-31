import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, CircleCheck, Database, FlaskConical, Layers, LoaderCircle, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { api } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { StatusBadge } from "../../components/StatusBadge";
import { useToken } from "../../components/TokenContext";
import { buttonClass } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState, LoadingBlock, PageHeader, ProgressBar } from "../../components/ui/Feedback";
import { RelativeTime } from "../../components/ui/RelativeTime";
import { StatCard } from "../../components/ui/StatCard";
import { Table } from "../../components/ui/Table";
import { cx } from "../../lib/cx";
import { formatCount } from "../../lib/format";
import { FitnessValue } from "../batches/FitnessValue";
import { bestFitness, isBatchActive, POLL_INTERVAL_MS } from "../batches/status";

const READY = new Set(["ready", "ready_with_errors"]);

function Step({ done, title, children, to, cta }: { done: boolean; title: string; children: ReactNode; to?: string; cta?: string }) {
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span
        aria-hidden
        className={cx(
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs",
          done ? "border-success/50 bg-success-soft text-success" : "border-border text-subtle",
        )}
      >
        {done && <Check className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx("text-sm font-medium", done ? "text-muted line-through decoration-subtle" : "text-fg")}>
          {title}
          <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
        </p>
        <p className="text-xs text-muted">{children}</p>
      </div>
      {!done && to && cta && (
        <Link to={to} className={buttonClass("secondary", "sm", "self-center")}>
          {cta}
        </Link>
      )}
    </li>
  );
}

export function OverviewPage() {
  const { token } = useToken();
  const datasets = useQuery({
    queryKey: ["datasets", "list"],
    queryFn: () => api.listDatasets(),
    enabled: Boolean(token),
  });
  const batches = useQuery({
    queryKey: ["batches", "list"],
    queryFn: () => api.listBatches(),
    enabled: Boolean(token),
    refetchInterval: (q) => (q.state.data?.items.some(isBatchActive) ? POLL_INTERVAL_MS : false),
  });
  const batchItems = batches.data?.items ?? [];
  // Batches are listed newest first: the first fully completed one is the most recent.
  const latestCompleted = batchItems.find((b) => b.status === "completed");
  const latestJobs = useQuery({
    queryKey: ["batches", latestCompleted?.id ?? "", "jobs"],
    queryFn: () => api.listBatchJobs(latestCompleted!.id),
    enabled: Boolean(token && latestCompleted),
  });
  const scores = (latestJobs.data?.items ?? []).map(bestFitness).filter((v): v is number => v !== undefined);
  const best = scores.length ? Math.max(...scores) : undefined;
  const bestJob = latestJobs.data?.items.find((j) => bestFitness(j) === best);

  const datasetItems = datasets.data?.items ?? [];
  const readyCount = datasetItems.filter((d) => READY.has(d.status)).length;
  const running = batchItems.reduce((n, b) => n + (b.counts.running ?? 0), 0);
  const completed = batchItems.reduce((n, b) => n + (b.counts.completed ?? 0), 0);
  const loaded = Boolean(datasets.data && batches.data);
  const more = (page?: { next_cursor?: string | null }) => (page?.next_cursor ? "+" : "");

  const steps = [
    { done: Boolean(token), title: "Add your API token", text: "Paste the token from the CLI into the sidebar." },
    { done: datasetItems.length > 0, title: "Upload a dataset", text: "CSV, NDJSON or JSON with designs and staple variants.", to: "/datasets", cta: "Upload" },
    { done: batchItems.length > 0, title: "Start a batch", text: "Pick designs, an objective and a seed.", to: "/batches", cta: "New batch" },
    { done: completed > 0, title: "View results", text: "Open a completed job for its fitness chart and ranking.", to: "/batches", cta: "Batches" },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Computational design workbench"
        title="Overview"
        description="DNA origami datasets, optimization batches and their results at a glance. Every score is a computational proxy."
        actions={
          <>
            <Link to="/datasets" className={buttonClass("secondary")}>
              <Database aria-hidden className="size-4" />
              Upload dataset
            </Link>
            <Link to="/batches" className={buttonClass("primary")}>
              <FlaskConical aria-hidden className="size-4" />
              New batch
            </Link>
          </>
        }
      />
      {(datasets.error || batches.error) && (
        <ErrorMessage
          error={datasets.error ?? batches.error}
          onRetry={() => {
            void datasets.refetch();
            void batches.refetch();
          }}
        />
      )}

      <dl aria-label="Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Datasets"
          value={loaded ? `${formatCount(datasetItems.length)}${more(datasets.data)}` : "—"}
          hint={loaded ? `${formatCount(readyCount)} ready` : undefined}
          icon={<Database className="size-4" />}
          tone="primary"
        />
        <StatCard
          label="Batches"
          value={loaded ? `${formatCount(batchItems.length)}${more(batches.data)}` : "—"}
          icon={<Layers className="size-4" />}
          tone="info"
        />
        <StatCard
          label="Jobs running"
          value={loaded ? formatCount(running) : "—"}
          icon={<LoaderCircle className={cx("size-4", running > 0 && "motion-safe:animate-spin")} />}
          tone="info"
        />
        <StatCard
          label="Jobs completed"
          value={loaded ? formatCount(completed) : "—"}
          icon={<CircleCheck className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Best fitness (latest batch)"
          value={best !== undefined ? <FitnessValue fitness={latestCompleted?.fitness.name} score={best} components={bestJob?.result?.best_components as Record<string, unknown> | undefined} /> : "—"}
          hint={latestCompleted ? <span className="font-mono">{latestCompleted.fitness.name}</span> : loaded ? "no completed batch yet" : undefined}
          icon={<Trophy className="size-4" />}
          tone="warning"
        />
      </dl>
      <p className="-mt-3 text-xs text-subtle">Batch and job counts cover the latest {formatCount(batchItems.length || 25)} batches.</p>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card
          title="Recent batches"
          icon={<FlaskConical className="size-4" />}
          actions={
            <Link to="/batches" className={buttonClass("ghost", "sm")}>
              All batches <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          }
        >
          {!token && <p className="text-sm text-muted">Set an API token in the sidebar to see batches.</p>}
          {token && batches.isPending && <LoadingBlock rows={4} />}
          {batches.data && batchItems.length === 0 && (
            <EmptyState
              icon={<FlaskConical className="size-5" />}
              title="No batches yet"
              action={
                <Link to="/batches" className={buttonClass("primary", "sm")}>
                  Start your first batch
                </Link>
              }
            >
              A batch runs one optimization job per selected design.
            </EmptyState>
          )}
          {batchItems.length > 0 && (
            <Table>
              <table>
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {batchItems.slice(0, 5).map((b) => {
                    const done = (b.counts.completed ?? 0) + (b.counts.failed ?? 0) + (b.counts.cancelled ?? 0);
                    return (
                      <tr key={b.id}>
                        <td>
                          <Link to={`/batches/${b.id}`} className="font-medium text-fg hover:text-primary hover:underline">
                            {b.name ?? <span className="font-mono text-xs">{b.id}</span>}
                          </Link>
                          <div className="font-mono text-xs text-subtle">{b.fitness.name}</div>
                        </td>
                        <td>
                          <StatusBadge status={b.status} />
                        </td>
                        <td className="min-w-32">
                          <ProgressBar
                            label={`${done} of ${b.total_jobs} jobs finished`}
                            value={done}
                            max={b.total_jobs}
                            segments={[
                              { value: b.counts.completed ?? 0, tone: "success" },
                              { value: b.counts.failed ?? 0, tone: "danger" },
                              { value: b.counts.cancelled ?? 0, tone: "neutral" },
                            ]}
                          />
                          <span className="mt-1 block font-mono text-xs text-subtle">
                            {formatCount(b.counts.completed ?? 0)}/{formatCount(b.total_jobs)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-muted">
                          <RelativeTime iso={b.created_at} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Table>
          )}
        </Card>

        <Card title="Get started" description={allDone ? "All steps done." : "Each step is ticked from your data."}>
          <ol aria-label="Get started checklist" className="divide-y divide-border">
            {steps.map((s) => (
              <Step key={s.title} done={s.done} title={s.title} to={s.to} cta={s.cta}>
                {s.text}
              </Step>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
