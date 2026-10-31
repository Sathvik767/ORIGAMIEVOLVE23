import { useQuery } from "@tanstack/react-query";
import { Database, HardDrive, RefreshCw, Server, Zap } from "lucide-react";
import type { ReactNode } from "react";

import { api } from "../api/client";
import { cx } from "../lib/cx";
import { formatDate } from "../lib/format";
import { Button } from "./ui/Button";
import { cardClass } from "./ui/Card";
import { Callout, PageHeader, Skeleton } from "./ui/Feedback";

const SERVICES: Record<string, { label: string; icon: ReactNode; role: string }> = {
  mongo: { label: "MongoDB", icon: <Database className="size-5" />, role: "Datasets, designs, batches and jobs" },
  redis: { label: "Redis", icon: <Zap className="size-5" />, role: "Job queue (Celery broker)" },
  storage: { label: "Storage", icon: <HardDrive className="size-5" />, role: "Uploaded files and results" },
};

export function SystemStatus() {
  const { data, error, isPending, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ["readiness"],
    queryFn: api.readiness,
    refetchInterval: 10_000,
  });
  const checked = dataUpdatedAt ? formatDate(new Date(dataUpdatedAt).toISOString()) : null;

  return (
    <section aria-labelledby="status-heading" className="space-y-6">
      <PageHeader
        title={<span id="status-heading">System status</span>}
        description="Readiness of the services the API depends on. Refreshes every 10 seconds."
        actions={
          <Button
            size="sm"
            icon={<RefreshCw aria-hidden className={cx("size-3.5", isFetching && "motion-safe:animate-spin")} />}
            onClick={() => void refetch()}
          >
            Check now
          </Button>
        }
      />
      {isPending && (
        <div aria-busy="true" className="grid gap-4 sm:grid-cols-3">
          <span className="sr-only">Checking services…</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}
      {error && (
        <Callout tone="danger" icon={<Server />} title="API unreachable. Is the backend running on port 8000?">
          The status of MongoDB, Redis and storage can only be checked through the API.
        </Callout>
      )}
      {data && (
        <ul className="grid gap-4 sm:grid-cols-3">
          {Object.entries(data.checks).map(([name, result]) => {
            const ok = result === "ok";
            const svc = SERVICES[name] ?? { label: name, icon: <Server className="size-5" />, role: "" };
            return (
              <li key={name} className={cx(cardClass, "p-5")}>
                <div className="flex items-start justify-between gap-3">
                  <span aria-hidden className={cx("grid size-10 place-items-center rounded-lg", ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
                    {svc.icon}
                  </span>
                  <span className={cx("inline-flex items-center gap-1.5 text-xs font-medium", ok ? "text-success" : "text-danger")}>
                    <span aria-hidden className={cx("size-2 rounded-full", ok ? "bg-success" : "bg-danger")} />
                    {ok ? "Operational" : "Unavailable"}
                  </span>
                </div>
                <p className="mt-3 font-semibold text-fg">
                  {svc.label} <span className="font-mono text-xs font-normal text-subtle">{name}</span>
                </p>
                <p className="text-xs text-muted">{svc.role}</p>
                <p className={cx("mt-2 font-mono text-sm break-words", ok ? "text-success" : "text-danger")}>{result}</p>
                {checked && <p className="mt-2 text-xs text-subtle">Last checked {checked}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
