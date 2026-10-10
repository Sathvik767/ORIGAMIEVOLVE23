import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { api, type DatasetOut } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { StatusBadge } from "../../components/StatusBadge";
import { useToken } from "../../components/TokenContext";
import { formatBytes, formatDate } from "../../lib/format";

const IN_PROGRESS = new Set(["uploaded", "ingesting"]);

export function isInProgress(d: DatasetOut): boolean {
  return IN_PROGRESS.has(d.status) && d.ingest_job?.status !== "failed";
}

export function DatasetList() {
  const { token } = useToken();
  const { data, error, isPending } = useQuery({
    queryKey: ["datasets", "list"],
    queryFn: () => api.listDatasets(),
    enabled: Boolean(token),
    // Poll only while something is still being validated.
    refetchInterval: (q) => (q.state.data?.items.some(isInProgress) ? 2000 : false),
  });

  return (
    <section aria-labelledby="datasets-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="datasets-heading" className="mb-3 text-lg font-semibold text-slate-800">
        Datasets
      </h2>
      {!token && <p className="text-sm text-slate-500">Set an API token in the header to see datasets.</p>}
      {token && isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <ErrorMessage error={error} />}
      {data && data.items.length === 0 && <p className="text-sm text-slate-500">No datasets yet. Upload one above.</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4 text-right">Valid designs</th>
                <th className="py-2 pr-4 text-right">Errors</th>
                <th className="py-2 pr-4">Format</th>
                <th className="py-2 pr-4 text-right">Size</th>
                <th className="py-2">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((d) => (
                <tr key={d.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-4">
                    <Link to={`/datasets/${d.id}`} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                      {d.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{d.counts.designs_valid ?? 0}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{d.counts.error_count ?? 0}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{d.format}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatBytes(d.size_bytes)}</td>
                  <td className="py-2 text-slate-500">{formatDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
