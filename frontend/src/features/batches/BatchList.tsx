import { useQuery } from "@tanstack/react-query";
import { FlaskConical, KeyRound, Layers } from "lucide-react";
import { Link } from "react-router";

import { api } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { StatusBadge } from "../../components/StatusBadge";
import { useToken } from "../../components/TokenContext";
import { Card } from "../../components/ui/Card";
import { EmptyState, LoadingBlock, ProgressBar } from "../../components/ui/Feedback";
import { RelativeTime } from "../../components/ui/RelativeTime";
import { Table } from "../../components/ui/Table";
import { formatCount } from "../../lib/format";
import { isBatchActive, POLL_INTERVAL_MS } from "./status";

export function BatchList() {
  const { token } = useToken();
  const batches = useQuery({
    queryKey: ["batches", "list"],
    queryFn: () => api.listBatches(),
    enabled: Boolean(token),
    refetchInterval: (q) => (q.state.data?.items.some(isBatchActive) ? POLL_INTERVAL_MS : false),
  });
  const datasets = useQuery({
    queryKey: ["datasets", "list"],
    queryFn: () => api.listDatasets(),
    enabled: Boolean(token),
  });
  const datasetName = new Map((datasets.data?.items ?? []).map((d) => [d.id, d.name]));

  return (
    <Card title="Batches" icon={<Layers className="size-4" />}>
      {!token && <EmptyState icon={<KeyRound className="size-5" />} title="Set an API token in the sidebar to see batches." />}
      {token && batches.isPending && <LoadingBlock label="Loading batches…" rows={4} />}
      {batches.error && <ErrorMessage error={batches.error} onRetry={() => void batches.refetch()} />}
      {batches.data && batches.data.items.length === 0 && (
        <EmptyState icon={<FlaskConical className="size-5" />} title="No batches yet. Start one above.">
          Choose a validated dataset, select designs and start your first batch.
        </EmptyState>
      )}
      {batches.data && batches.data.items.length > 0 && (
        <Table>
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Dataset</th>
                <th>Created</th>
                <th>Status</th>
                <th>Progress</th>
                <th className="text-right">Jobs</th>
                <th className="text-right">Completed</th>
                <th className="text-right">Failed</th>
                <th className="text-right">Running</th>
                <th className="text-right">Queued</th>
              </tr>
            </thead>
            <tbody>
              {batches.data.items.map((b) => {
                const finished = (b.counts.completed ?? 0) + (b.counts.failed ?? 0) + (b.counts.cancelled ?? 0);
                return (
                  <tr key={b.id}>
                    <td>
                      <Link to={`/batches/${b.id}`} className="font-medium text-fg hover:text-primary hover:underline">
                        {b.name ?? <span className="font-mono text-xs">{b.id}</span>}
                      </Link>
                      <div className="font-mono text-xs text-subtle">
                        {b.fitness.name}
                        {b.method ? ` · ${b.method}` : ""}
                      </div>
                    </td>
                    <td className="text-muted">{datasetName.get(b.dataset_id) ?? <span className="font-mono text-xs">{b.dataset_id}</span>}</td>
                    <td className="whitespace-nowrap text-muted">
                      <RelativeTime iso={b.created_at} />
                    </td>
                    <td>
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="min-w-28">
                      <ProgressBar
                        label={`${finished} of ${b.total_jobs} jobs finished`}
                        value={finished}
                        max={b.total_jobs}
                        segments={[
                          { value: b.counts.completed ?? 0, tone: "success" },
                          { value: b.counts.failed ?? 0, tone: "danger" },
                          { value: b.counts.cancelled ?? 0, tone: "neutral" },
                        ]}
                      />
                    </td>
                    <td className="text-right font-mono">{formatCount(b.total_jobs)}</td>
                    <td className="text-right font-mono text-success">{formatCount(b.counts.completed)}</td>
                    <td className="text-right font-mono text-danger">{formatCount(b.counts.failed)}</td>
                    <td className="text-right font-mono text-info">{formatCount(b.counts.running)}</td>
                    <td className="text-right font-mono text-muted">{formatCount(b.counts.queued)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Table>
      )}
    </Card>
  );
}
