import { useState } from "react";

import { downloadReport, type ReportSummary } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { describeIssue } from "../../lib/errorCodes";

interface Sample {
  code: string;
  message: string;
  location: number | null;
  design_id: string | null;
  field: string | null;
}

export function ReportView({ datasetId, report }: { datasetId: string; report: ReportSummary }) {
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const codes = [
    ...Object.entries(report.errors_by_code).map(([code, count]) => ({ code, count, severity: "error" as const })),
    ...Object.entries(report.warnings_by_code).map(([code, count]) => ({ code, count, severity: "warning" as const })),
  ];
  const locationLabel = report.location_kind === "index" ? "Element" : "Line";

  return (
    <section aria-labelledby="report-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="report-heading" className="text-lg font-semibold text-slate-800">
          Validation report
        </h2>
        <button
          type="button"
          onClick={() => downloadReport(datasetId).catch(setDownloadError)}
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Download full report (JSON)
        </button>
      </div>
      {downloadError !== null && <ErrorMessage error={downloadError} />}

      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Records read", report.records_read],
          ["Valid designs", report.designs_valid],
          ["Rejected designs", report.designs_invalid],
          ["Errors", report.error_count],
          ["Warnings", report.warning_count],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {report.fatal && (
        <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <strong>Ingestion stopped:</strong> {String(report.fatal.message)} ({String(report.fatal.code)})
        </p>
      )}

      {codes.length === 0 ? (
        <p className="text-sm text-emerald-800">No problems found.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Designs with any error are rejected whole; only valid designs are stored.
          </p>
          {codes.map(({ code, count, severity }) => (
            <details key={code} className="rounded border border-slate-200">
              <summary className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <span className={`font-mono text-xs ${severity === "error" ? "text-red-700" : "text-amber-700"}`}>
                  {code}
                </span>
                <span className="flex-1 text-slate-700">{describeIssue(code)}</span>
                <span className="tabular-nums text-slate-500">{count}</span>
              </summary>
              <table className="w-full border-t border-slate-100 text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-3 py-1">{locationLabel}</th>
                    <th className="px-3 py-1">Design</th>
                    <th className="px-3 py-1">Field</th>
                    <th className="px-3 py-1">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {((report.samples[code] ?? []) as unknown as Sample[]).map((s, i) => (
                    <tr key={i} className="border-t border-slate-50">
                      <td className="px-3 py-1 tabular-nums">{s.location ?? "—"}</td>
                      <td className="px-3 py-1 font-mono">{s.design_id ?? "—"}</td>
                      <td className="px-3 py-1 font-mono">{s.field ?? "—"}</td>
                      <td className="px-3 py-1">{s.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {count > (report.samples[code]?.length ?? 0) && (
                <p className="border-t border-slate-100 px-3 py-1 text-xs text-slate-500">
                  Showing {report.samples[code]?.length ?? 0} of {count}. Download the full report for all.
                </p>
              )}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
