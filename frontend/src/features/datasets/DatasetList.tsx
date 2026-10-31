import { useQuery } from "@tanstack/react-query";
import { Database, KeyRound } from "lucide-react";
import { Link } from "react-router";

import { api, type DatasetOut } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { StatusBadge } from "../../components/StatusBadge";
import { useToken } from "../../components/TokenContext";
import { Card } from "../../components/ui/Card";
import { EmptyState, LoadingBlock } from "../../components/ui/Feedback";
import { RelativeTime } from "../../components/ui/RelativeTime";
import { Table } from "../../components/ui/Table";
import { formatBytes, formatCount } from "../../lib/format";

const IN_PROGRESS = new Set(["uploaded", "ingesting"]);

export function isInProgress(d: DatasetOut): boolean {
  return IN_PROGRESS.has(d.status) && d.ingest_job?.status !== "failed";
}

export function DatasetList() {
  const { token } = useToken();
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["datasets", "list"],
    queryFn: () => api.listDatasets(),
    enabled: Boolean(token),
    // Poll only while something is still being validated.
    refetchInterval: (q) => (q.state.data?.items.some(isInProgress) ? 2000 : false),
  });

  return (
    <Card title="Datasets" icon={<Database className="size-4" />}>
      {!token && (
        <EmptyState icon={<KeyRound className="size-5" />} title="Set an API token in the sidebar to see datasets.">
          Create one with <code className="font-mono text-xs">python -m origami_api.cli create-token</code>.
        </EmptyState>
      )}
      {token && isPending && <LoadingBlock label="Loading datasets…" rows={4} />}
      {error && <ErrorMessage error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState icon={<Database className="size-5" />} title="No datasets yet. Upload one above.">
          Try <code className="font-mono text-xs">examples/synthetic_designs.csv</code> to get started.
        </EmptyState>
      )}
      {data && data.items.length > 0 && (
        <Table>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th className="text-right">Valid designs</th>
                <th className="text-right">Errors</th>
                <th>Format</th>
                <th className="text-right">Size</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link to={`/datasets/${d.id}`} className="font-medium text-fg hover:text-primary hover:underline">
                      {d.name}
                    </Link>
                    {d.original_filename && <div className="font-mono text-xs text-subtle">{d.original_filename}</div>}
                  </td>
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="text-right font-mono">{formatCount(d.counts.designs_valid ?? 0)}</td>
                  <td className={`text-right font-mono ${d.counts.error_count ? "text-danger" : "text-subtle"}`}>
                    {formatCount(d.counts.error_count ?? 0)}
                  </td>
                  <td className="font-mono text-xs text-muted uppercase">{d.format}</td>
                  <td className="text-right font-mono text-muted">{formatBytes(d.size_bytes)}</td>
                  <td className="whitespace-nowrap text-muted">
                    <RelativeTime iso={d.created_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Table>
      )}
    </Card>
  );
}
