import { ChevronRight, CircleCheck, CircleX, ClipboardCheck, Download, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { downloadReport, type ReportSummary } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Callout } from "../../components/ui/Feedback";
import { StatCard } from "../../components/ui/StatCard";
import { describeIssue } from "../../lib/errorCodes";
import { formatCount } from "../../lib/format";

interface Sample {
  code: string;
  message: string;
  location: number | null;
  design_id: string | null;
  field: string | null;
}

export function ReportView({ datasetId, report }: { datasetId: string; report: ReportSummary }) {
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const groups = [
    { severity: "error" as const, title: "Errors", entries: Object.entries(report.errors_by_code) },
    { severity: "warning" as const, title: "Warnings", entries: Object.entries(report.warnings_by_code) },
  ].filter((g) => g.entries.length > 0);
  const locationLabel = report.location_kind === "index" ? "Element" : "Line";

  return (
    <Card
      title="Validation report"
      icon={<ClipboardCheck className="size-4" />}
      actions={
        <Button size="sm" icon={<Download aria-hidden className="size-3.5" />} onClick={() => downloadReport(datasetId).catch(setDownloadError)}>
          Download full report (JSON)
        </Button>
      }
    >
      {downloadError !== null && (
        <div className="mb-4">
          <ErrorMessage error={downloadError} />
        </div>
      )}

      <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Records read" value={formatCount(report.records_read)} />
        <StatCard label="Valid designs" value={formatCount(report.designs_valid)} />
        <StatCard label="Rejected designs" value={formatCount(report.designs_invalid)} />
        <StatCard label="Errors" value={formatCount(report.error_count)} tone="danger" />
        <StatCard label="Warnings" value={formatCount(report.warning_count)} tone="warning" />
      </dl>

      {report.fatal && (
        <div className="mb-4">
          <Callout role="alert" tone="danger" icon={<CircleX />}>
            <strong>Ingestion stopped:</strong> {String(report.fatal.message)} ({String(report.fatal.code)})
          </Callout>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <CircleCheck aria-hidden className="size-4" />
          No problems found.
        </p>
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-muted">Designs with any error are rejected whole; only valid designs are stored.</p>
          {groups.map((g) => (
            <div key={g.severity} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                {g.severity === "error" ? (
                  <CircleX aria-hidden className="size-4 text-danger" />
                ) : (
                  <TriangleAlert aria-hidden className="size-4 text-accent" />
                )}
                {g.title}
              </h3>
              {g.entries.map(([code, count]) => (
                <details key={code} className="group rounded-lg border border-border bg-surface-sunken/40">
                  <summary className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-surface-raised">
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle transition-transform duration-150 group-open:rotate-90" />
                    <span className={`font-mono text-xs ${g.severity === "error" ? "text-danger" : "text-accent"}`}>{code}</span>
                    <span className="min-w-0 flex-1 text-fg/90">{describeIssue(code)}</span>
                    <Badge tone={g.severity === "error" ? "danger" : "warning"}>{formatCount(count)}</Badge>
                  </summary>
                  <div className="overflow-x-auto border-t border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="text-muted">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">{locationLabel}</th>
                          <th className="px-3 py-1.5 font-medium">Design</th>
                          <th className="px-3 py-1.5 font-medium">Field</th>
                          <th className="px-3 py-1.5 font-medium">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {((report.samples[code] ?? []) as unknown as Sample[]).map((s, i) => (
                          <tr key={i} className="border-t border-border/60">
                            <td className="px-3 py-1.5 font-mono">{s.location ?? "—"}</td>
                            <td className="px-3 py-1.5 font-mono">{s.design_id ?? "—"}</td>
                            <td className="px-3 py-1.5 font-mono">{s.field ?? "—"}</td>
                            <td className="px-3 py-1.5">{s.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {count > (report.samples[code]?.length ?? 0) && (
                    <p className="border-t border-border px-3 py-1.5 text-xs text-muted">
                      Showing {report.samples[code]?.length ?? 0} of {count}. Download the full report for all.
                    </p>
                  )}
                </details>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
