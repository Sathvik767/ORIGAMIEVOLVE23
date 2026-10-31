import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Dna, GitBranch, KeyRound, Orbit, Ruler, Shuffle } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { api } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { useToken } from "../../components/TokenContext";
import { buttonClass, IconButton } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Callout, EmptyState, LoadingBlock, PageHeader } from "../../components/ui/Feedback";
import { StatCard } from "../../components/ui/StatCard";
import { Table } from "../../components/ui/Table";
import { Tabs } from "../../components/ui/Tabs";
import { useToast } from "../../components/ui/Toast";
import { formatCount } from "../../lib/format";

/** GC fraction of a sequence, as a percentage (a plain count of G and C; no model). */
function gcPercent(seq: string): string {
  if (!seq) return "—";
  const gc = [...seq.toUpperCase()].filter((b) => b === "G" || b === "C").length;
  return `${((gc / seq.length) * 100).toFixed(1)}%`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? "Copied" : label}
      icon={copied ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
          toast("Sequence copied");
        } catch {
          toast("Copy failed: the browser blocked clipboard access.", "error");
        }
      }}
    />
  );
}

export function DesignDetail() {
  const { designId = "" } = useParams();
  const { token } = useToken();
  const [tab, setTab] = useState("staples");
  const { data, error, refetch } = useQuery({
    queryKey: ["designs", designId],
    queryFn: () => api.getDesign(designId),
    enabled: Boolean(token),
  });

  if (!token) return <EmptyState icon={<KeyRound className="size-5" />} title="Set an API token in the sidebar." />;
  if (error) return <ErrorMessage error={error} onRetry={() => void refetch()} />;
  if (!data) return <LoadingBlock label="Loading design…" rows={6} />;

  const metadata = Object.entries(data.metadata);
  const variantCount = data.staples.reduce((n, s) => n + (s.candidates?.length ?? 0), 0);
  const withVariants = data.staples.filter((s) => (s.candidates?.length ?? 0) > 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Design"
        title={data.name ?? data.external_id}
        description={<span className="font-mono text-xs">{data.external_id}</span>}
        actions={
          <>
            <Link to={`/datasets/${data.dataset_id}`} className={buttonClass("ghost")}>
              ← Dataset
            </Link>
            <Link to={`/viewer?design=${encodeURIComponent(data.id)}`} className={buttonClass("primary")}>
              <Orbit aria-hidden className="size-4" />
              View in 3D viewer
            </Link>
          </>
        }
      />

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Scaffold length"
          value={data.scaffold ? `${formatCount(data.scaffold.sequence.length)} nt` : "—"}
          hint={data.scaffold ? <span className="font-mono">{data.scaffold.id}</span> : "No scaffold supplied."}
          icon={<Ruler className="size-4" />}
          tone={data.scaffold ? "primary" : "warning"}
        />
        <StatCard label="Staples" value={formatCount(data.staples.length)} icon={<GitBranch className="size-4" />} tone="info" />
        <StatCard
          label="Supplied variants"
          value={formatCount(variantCount)}
          hint={`${formatCount(withVariants)} staple${withVariants === 1 ? "" : "s"} with variants`}
          icon={<Shuffle className="size-4" />}
          tone="success"
        />
      </dl>

      <Card>
        <Tabs
          label="Design details"
          value={tab}
          onChange={setTab}
          items={[
            {
              id: "staples",
              label: `Staples (${data.staples.length})`,
              content: (
                <section aria-labelledby="staples-heading">
                  <h2 id="staples-heading" className="sr-only">
                    Staples ({data.staples.length})
                  </h2>
                  <Table sticky zebra maxHeight="36rem">
                    <table className="text-xs">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th className="text-right">Helix</th>
                          <th className="text-right">Start</th>
                          <th className="text-right">End</th>
                          <th className="text-right">GC %</th>
                          <th>Sequence</th>
                          <th>Variants</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {data.staples.map((s) => (
                          <tr key={s.id} className="align-top">
                            <td className="whitespace-nowrap">{s.id}</td>
                            <td className="text-right">{s.helix ?? "—"}</td>
                            <td className="text-right">{s.start ?? "—"}</td>
                            <td className="text-right">{s.end ?? "—"}</td>
                            <td className="text-right text-muted">{gcPercent(s.sequence)}</td>
                            <td>
                              <div className="flex items-start gap-1">
                                <span className="min-w-48 break-all">{s.sequence}</span>
                                <CopyButton text={s.sequence} label={`Copy sequence of ${s.id}`} />
                              </div>
                            </td>
                            <td className="break-all text-muted">{(s.candidates ?? []).join(" ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Table>
                  <p className="mt-2 text-xs text-subtle">GC % is the share of G and C bases in the staple sequence.</p>
                </section>
              ),
            },
            {
              id: "measurements",
              label: `Imported measurements (${data.measurements.length})`,
              content: (
                <section aria-labelledby="measurements-heading">
                  <h2 id="measurements-heading" className="sr-only">
                    Imported measurements
                  </h2>
                  <Callout tone="info" icon={<Dna />} className="mb-4">
                    Values supplied by the user in the uploaded file, shown verbatim. OrigamiEvolve does not compute or verify them.
                  </Callout>
                  {data.measurements.length === 0 ? (
                    <p className="text-sm text-muted">None.</p>
                  ) : (
                    <Table>
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th className="text-right">Value</th>
                            <th>Unit</th>
                            <th>Method</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.measurements.map((m) => (
                            <tr key={m.name}>
                              <td className="font-mono text-xs">{m.name}</td>
                              <td className="text-right font-mono">{m.value}</td>
                              <td>{m.unit ?? "—"}</td>
                              <td>{m.method ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Table>
                  )}
                </section>
              ),
            },
            {
              id: "metadata",
              label: `Metadata (${metadata.length})`,
              content:
                metadata.length === 0 ? (
                  <p className="text-sm text-muted">No metadata.</p>
                ) : (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                    {metadata.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="font-mono text-xs leading-5 text-muted">{k}</dt>
                        <dd className="break-all">{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
