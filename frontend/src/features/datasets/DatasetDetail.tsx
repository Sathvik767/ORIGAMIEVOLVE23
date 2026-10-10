import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";

import { api } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { StatusBadge } from "../../components/StatusBadge";
import { useToken } from "../../components/TokenContext";
import { formatBytes, formatDate } from "../../lib/format";
import { isInProgress } from "./DatasetList";
import { ReportView } from "./ReportView";

export function DatasetDetail() {
  const { datasetId = "" } = useParams();
  const { token } = useToken();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const dataset = useQuery({
    queryKey: ["datasets", datasetId],
    queryFn: () => api.getDataset(datasetId),
    enabled: Boolean(token),
    refetchInterval: (q) => (q.state.data && isInProgress(q.state.data) ? 2000 : false),
  });
  const hasReport = Boolean(dataset.data && !isInProgress(dataset.data) && dataset.data.counts.records_read !== undefined);
  const report = useQuery({
    queryKey: ["datasets", datasetId, "report", dataset.data?.updated_at],
    queryFn: () => api.getReport(datasetId),
    enabled: hasReport,
    retry: false,
  });
  const designs = useInfiniteQuery({
    queryKey: ["datasets", datasetId, "designs", dataset.data?.updated_at],
    queryFn: ({ pageParam }) => api.listDesigns(datasetId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: hasReport,
  });

  const reingest = useMutation({
    mutationFn: () => api.reingest(datasetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["datasets"] }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteDataset(datasetId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      void navigate("/datasets");
    },
  });

  if (!token) return <p className="text-sm text-slate-500">Set an API token in the header.</p>;
  if (dataset.error) return <ErrorMessage error={dataset.error} />;
  if (!dataset.data) return <p className="text-sm text-slate-500">Loading…</p>;

  const d = dataset.data;
  const busy = isInProgress(d);
  const jobError = d.ingest_job?.error as { code?: string; message?: string; retryable?: boolean } | null | undefined;

  return (
    <div className="space-y-6">
      <nav className="text-sm">
        <Link to="/datasets" className="text-slate-500 hover:text-slate-800">
          ← Datasets
        </Link>
      </nav>
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{d.name}</h2>
            {d.description && <p className="text-sm text-slate-600">{d.description}</p>}
          </div>
          <StatusBadge status={d.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-slate-500">File</dt>
          <dd className="truncate">{d.original_filename ?? "—"}</dd>
          <dt className="text-slate-500">Format</dt>
          <dd className="font-mono text-xs">{d.format}</dd>
          <dt className="text-slate-500">Size</dt>
          <dd>{formatBytes(d.size_bytes)}</dd>
          <dt className="text-slate-500">Uploaded</dt>
          <dd>{formatDate(d.created_at)}</dd>
          <dt className="text-slate-500">SHA-256</dt>
          <dd className="col-span-3 truncate font-mono text-xs" title={d.sha256}>
            {d.sha256}
          </dd>
        </dl>
        {busy && <p className="mt-4 text-sm text-sky-800">Validating… this page updates automatically.</p>}
        {jobError && (
          <p role="alert" className="mt-4 text-sm text-red-800">
            Ingestion failed: {jobError.message} <span className="font-mono text-xs">({jobError.code})</span>
          </p>
        )}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            disabled={busy || reingest.isPending}
            onClick={() => reingest.mutate()}
            className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-40"
          >
            Re-run validation
          </button>
          <button
            type="button"
            disabled={busy || remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete dataset "${d.name}"?`)) remove.mutate();
            }}
            className="rounded border border-red-200 px-3 py-1 text-sm text-red-700 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
        {(reingest.error || remove.error) && (
          <div className="mt-3">
            <ErrorMessage error={reingest.error ?? remove.error} />
          </div>
        )}
      </section>

      {report.data && <ReportView datasetId={d.id} report={report.data} />}

      {hasReport && (
        <section aria-labelledby="designs-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 id="designs-heading" className="mb-3 text-lg font-semibold text-slate-800">
            Designs
          </h2>
          {designs.error && <ErrorMessage error={designs.error} />}
          {designs.data && designs.data.pages[0]?.items.length === 0 && (
            <p className="text-sm text-slate-500">No valid designs were stored.</p>
          )}
          {designs.data && (designs.data.pages[0]?.items.length ?? 0) > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Design ID</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4 text-right">Scaffold (nt)</th>
                  <th className="py-2 pr-4 text-right">Staples</th>
                  <th className="py-2 pr-4 text-right">Candidate variants</th>
                  <th className="py-2">Imported measurements</th>
                </tr>
              </thead>
              <tbody>
                {designs.data.pages.flatMap((p) => p.items).map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">
                      <Link to={`/designs/${s.id}`} className="underline-offset-2 hover:underline">
                        {s.external_id}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{s.name ?? "—"}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{s.scaffold_length ?? "—"}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{s.staple_count}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{s.candidate_count}</td>
                    <td className="py-2 text-xs">{s.measurement_names.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {designs.hasNextPage && (
            <button
              type="button"
              onClick={() => void designs.fetchNextPage()}
              disabled={designs.isFetchingNextPage}
              className="mt-3 text-sm text-slate-600 underline"
            >
              Load more
            </button>
          )}
        </section>
      )}
    </div>
  );
}
