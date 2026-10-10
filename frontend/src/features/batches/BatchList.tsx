import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { api } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { StatusBadge } from "../../components/StatusBadge";
import { useToken } from "../../components/TokenContext";
import { formatDate } from "../../lib/format";
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
    <section aria-labelledby="batches-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="batches-heading" className="mb-3 text-lg font-semibold text-slate-800">
        Batches
      </h2>
      {!token && <p className="text-sm text-slate-500">Set an API token in the header to see batches.</p>}
      {token && batches.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {batches.error && <ErrorMessage error={batches.error} />}
      {batches.data && batches.data.items.length === 0 && (
        <p className="text-sm text-slate-500">No batches yet. Start one above.</p>
      )}
      {batches.data && batches.data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-4">Batch</th>
                <th className="py-2 pr-4">Dataset</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4 text-right">Jobs</th>
                <th className="py-2 pr-4 text-right">Completed</th>
                <th className="py-2 pr-4 text-right">Failed</th>
                <th className="py-2 pr-4 text-right">Running</th>
                <th className="py-2 text-right">Queued</th>
              </tr>
            </thead>
            <tbody>
              {batches.data.items.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-4">
                    <Link to={`/batches/${b.id}`} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                      {b.name ?? <span className="font-mono text-xs">{b.id}</span>}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{datasetName.get(b.dataset_id) ?? <span className="font-mono text-xs">{b.dataset_id}</span>}</td>
                  <td className="py-2 pr-4 whitespace-nowrap text-slate-500">{formatDate(b.created_at)}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{b.total_jobs}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{b.counts.completed ?? "—"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{b.counts.failed ?? "—"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{b.counts.running ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums">{b.counts.queued ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
