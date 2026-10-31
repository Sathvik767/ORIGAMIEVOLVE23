import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, FileText, Hash, HardDrive, KeyRound, Layers, LoaderCircle, RotateCw, Search, Trash2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { api } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { StatusBadge } from "../../components/StatusBadge";
import { useToken } from "../../components/TokenContext";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Callout, EmptyState, LoadingBlock, PageHeader } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Field";
import { RelativeTime } from "../../components/ui/RelativeTime";
import { StatCard } from "../../components/ui/StatCard";
import { Table } from "../../components/ui/Table";
import { useToast } from "../../components/ui/Toast";
import { formatBytes, formatCount } from "../../lib/format";
import { isInProgress } from "./DatasetList";
import { ReportView } from "./ReportView";

export function DatasetDetail() {
  const { datasetId = "" } = useParams();
  const { token } = useToken();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [filter, setFilter] = useState("");

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
  const allDesigns = useMemo(() => designs.data?.pages.flatMap((p) => p.items) ?? [], [designs.data]);
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? allDesigns.filter((s) => s.external_id.toLowerCase().includes(needle) || (s.name ?? "").toLowerCase().includes(needle))
    : allDesigns;

  const reingest = useMutation({
    mutationFn: () => api.reingest(datasetId),
    onSuccess: () => {
      toast("Validation restarted");
      return queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteDataset(datasetId),
    onSuccess: async () => {
      toast("Dataset deleted");
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      void navigate("/datasets");
    },
  });

  if (!token)
    return <EmptyState icon={<KeyRound className="size-5" />} title="Set an API token in the sidebar." />;
  if (dataset.error) return <ErrorMessage error={dataset.error} onRetry={() => void dataset.refetch()} />;
  if (!dataset.data) return <LoadingBlock label="Loading dataset…" rows={6} />;

  const d = dataset.data;
  const busy = isInProgress(d);
  const jobError = d.ingest_job?.error as { code?: string; message?: string; retryable?: boolean } | null | undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dataset"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {d.name} <StatusBadge status={d.status} />
          </span>
        }
        description={d.description ?? undefined}
        actions={
          <>
            <Button
              disabled={busy || reingest.isPending}
              loading={reingest.isPending}
              icon={<RotateCw aria-hidden className="size-4" />}
              onClick={() => reingest.mutate()}
            >
              Re-run validation
            </Button>
            <Button
              variant="danger"
              disabled={busy || remove.isPending}
              icon={<Trash2 aria-hidden className="size-4" />}
              onClick={() => {
                if (window.confirm(`Delete dataset "${d.name}"?`)) remove.mutate();
              }}
            >
              Delete
            </Button>
          </>
        }
      />

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Valid designs" value={formatCount(d.counts.designs_valid ?? 0)} icon={<Boxes className="size-4" />} tone="success" />
        <StatCard
          label="Rejected designs"
          value={formatCount(d.counts.designs_invalid ?? 0)}
          icon={<TriangleAlert className="size-4" />}
          tone={d.counts.designs_invalid ? "warning" : "neutral"}
        />
        <StatCard label="Records read" value={formatCount(d.counts.records_read ?? 0)} icon={<Layers className="size-4" />} tone="info" />
        <StatCard label="File size" value={formatBytes(d.size_bytes)} hint={d.format.toUpperCase()} icon={<HardDrive className="size-4" />} />
      </dl>

      <Card title="File" icon={<FileText className="size-4" />}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
          <dt className="text-muted">File</dt>
          <dd className="truncate font-mono text-xs leading-5">{d.original_filename ?? "—"}</dd>
          <dt className="text-muted">Uploaded</dt>
          <dd>
            <RelativeTime iso={d.created_at} />
          </dd>
          <dt className="text-muted">Format</dt>
          <dd className="font-mono text-xs leading-5 uppercase">{d.format}</dd>
          <dt className="flex items-center gap-1 text-muted">
            <Hash aria-hidden className="size-3.5" />
            SHA-256
          </dt>
          <dd className="truncate font-mono text-xs leading-5" title={d.sha256}>
            {d.sha256}
          </dd>
        </dl>
        {busy && (
          <p className="mt-4 flex items-center gap-2 text-sm text-info">
            <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
            Validating… this page updates automatically.
          </p>
        )}
        {jobError && (
          <div className="mt-4">
            <Callout role="alert" tone="danger" icon={<TriangleAlert />}>
              Ingestion failed: {jobError.message} <span className="font-mono text-xs">({jobError.code})</span>
            </Callout>
          </div>
        )}
        {(reingest.error || remove.error) && (
          <div className="mt-3">
            <ErrorMessage error={reingest.error ?? remove.error} />
          </div>
        )}
      </Card>

      {report.data && <ReportView datasetId={d.id} report={report.data} />}

      {hasReport && (
        <Card
          title="Designs"
          icon={<Boxes className="size-4" />}
          actions={
            allDesigns.length > 0 && (
              <label className="relative block w-full sm:w-64">
                <span className="sr-only">Filter designs</span>
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" />
                <Input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by ID or name"
                  className="h-8 pl-8"
                />
              </label>
            )
          }
        >
          {designs.isPending && <LoadingBlock label="Loading designs…" rows={4} />}
          {designs.error && <ErrorMessage error={designs.error} onRetry={() => void designs.refetch()} />}
          {designs.data && allDesigns.length === 0 && (
            <EmptyState icon={<Boxes className="size-5" />} title="No valid designs were stored.">
              See the validation report above for the reasons.
            </EmptyState>
          )}
          {allDesigns.length > 0 && (
            <Table sticky maxHeight="32rem">
              <table>
                <thead>
                  <tr>
                    <th>Design ID</th>
                    <th>Name</th>
                    <th className="text-right">Scaffold (nt)</th>
                    <th className="text-right">Staples</th>
                    <th className="text-right">Candidate variants</th>
                    <th>Imported measurements</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s.id}>
                      <td className="font-mono text-xs">
                        <Link to={`/designs/${s.id}`} className="text-primary hover:underline">
                          {s.external_id}
                        </Link>
                      </td>
                      <td>{s.name ?? "—"}</td>
                      <td className="text-right font-mono">{formatCount(s.scaffold_length)}</td>
                      <td className="text-right font-mono">{formatCount(s.staple_count)}</td>
                      <td className="text-right font-mono">{formatCount(s.candidate_count)}</td>
                      <td className="text-xs text-muted">{s.measurement_names.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && <p className="py-4 text-center text-sm text-muted">No loaded design matches “{filter}”.</p>}
            </Table>
          )}
          {designs.hasNextPage && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              loading={designs.isFetchingNextPage}
              onClick={() => void designs.fetchNextPage()}
            >
              Load more
            </Button>
          )}
          <p className="mt-2 text-xs text-subtle">
            {formatCount(allDesigns.length)} design{allDesigns.length === 1 ? "" : "s"} loaded
            {needle ? `, ${formatCount(shown.length)} shown` : ""}. Filtering applies to loaded designs.
          </p>
        </Card>
      )}
      <Link to="/datasets" className="text-sm text-muted hover:text-fg">
        ← Datasets
      </Link>
    </div>
  );
}
