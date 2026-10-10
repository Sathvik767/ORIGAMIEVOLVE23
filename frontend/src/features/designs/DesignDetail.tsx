import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { api } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { useToken } from "../../components/TokenContext";

export function DesignDetail() {
  const { designId = "" } = useParams();
  const { token } = useToken();
  const { data, error } = useQuery({
    queryKey: ["designs", designId],
    queryFn: () => api.getDesign(designId),
    enabled: Boolean(token),
  });

  if (!token) return <p className="text-sm text-slate-500">Set an API token in the header.</p>;
  if (error) return <ErrorMessage error={error} />;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;

  const metadata = Object.entries(data.metadata);
  return (
    <div className="space-y-6">
      <nav className="text-sm">
        <Link to={`/datasets/${data.dataset_id}`} className="text-slate-500 hover:text-slate-800">
          ← Dataset
        </Link>
      </nav>
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">{data.name ?? data.external_id}</h2>
        <p className="font-mono text-xs text-slate-500">{data.external_id}</p>
        <Link to={`/viewer?design=${encodeURIComponent(data.id)}`} className="text-sm underline">
          View in 3D viewer
        </Link>
        {data.scaffold ? (
          <p className="mt-3 text-sm">
            Scaffold <span className="font-mono">{data.scaffold.id}</span>: {data.scaffold.sequence.length} nt
          </p>
        ) : (
          <p className="mt-3 text-sm text-amber-800">No scaffold supplied.</p>
        )}
        {metadata.length > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 text-sm">
            {metadata.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby="measurements-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 id="measurements-heading" className="text-lg font-semibold text-slate-800">
          Imported measurements
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Values supplied by the user in the uploaded file, shown verbatim. OrigamiEvolve does not compute or verify them.
        </p>
        {data.measurements.length === 0 ? (
          <p className="text-sm text-slate-500">None.</p>
        ) : (
          <table className="text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-6">Name</th>
                <th className="py-1 pr-6">Value</th>
                <th className="py-1 pr-6">Unit</th>
                <th className="py-1">Method</th>
              </tr>
            </thead>
            <tbody>
              {data.measurements.map((m) => (
                <tr key={m.name}>
                  <td className="py-1 pr-6 font-mono text-xs">{m.name}</td>
                  <td className="py-1 pr-6 tabular-nums">{m.value}</td>
                  <td className="py-1 pr-6">{m.unit ?? "—"}</td>
                  <td className="py-1">{m.method ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="staples-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 id="staples-heading" className="mb-3 text-lg font-semibold text-slate-800">
          Staples ({data.staples.length})
        </h2>
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-4">ID</th>
                <th className="py-1 pr-4 text-right">Helix</th>
                <th className="py-1 pr-4 text-right">Start</th>
                <th className="py-1 pr-4 text-right">End</th>
                <th className="py-1 pr-4">Sequence</th>
                <th className="py-1">Variants</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {data.staples.map((s) => (
                <tr key={s.id} className="border-t border-slate-50 align-top">
                  <td className="py-1 pr-4">{s.id}</td>
                  <td className="py-1 pr-4 text-right">{s.helix ?? "—"}</td>
                  <td className="py-1 pr-4 text-right">{s.start ?? "—"}</td>
                  <td className="py-1 pr-4 text-right">{s.end ?? "—"}</td>
                  <td className="py-1 pr-4 break-all">{s.sequence}</td>
                  <td className="py-1 break-all">{(s.candidates ?? []).join(" ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
