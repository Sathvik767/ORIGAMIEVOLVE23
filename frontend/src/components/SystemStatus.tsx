import { useQuery } from "@tanstack/react-query";

import { api } from "../api/client";

export function SystemStatus() {
  const { data, error, isPending } = useQuery({
    queryKey: ["readiness"],
    queryFn: api.readiness,
    refetchInterval: 10_000,
  });

  return (
    <section aria-labelledby="status-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="status-heading" className="mb-3 text-lg font-semibold text-slate-800">
        System status
      </h2>
      {isPending && <p className="text-slate-500">Checking services…</p>}
      {error && (
        <p className="text-red-700">API unreachable. Is the backend running on port 8000?</p>
      )}
      {data && (
        <ul className="space-y-1">
          {Object.entries(data.checks).map(([name, result]) => (
            <li key={name} className="flex items-center justify-between font-mono text-sm">
              <span>{name}</span>
              <span className={result === "ok" ? "text-emerald-700" : "text-red-700"}>{result}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
