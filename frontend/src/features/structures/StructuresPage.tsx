import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, FileUp, KeyRound, Orbit, Shapes, Shuffle, UploadCloud } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";

import {
  api,
  uploadStructure,
  uploadStructureConfiguration,
  type StructureFormat,
  type StructureOut,
} from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { StatusBadge } from "../../components/StatusBadge";
import { useToken } from "../../components/TokenContext";
import { Badge } from "../../components/ui/Badge";
import { Button, buttonClass } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Callout, EmptyState, LoadingBlock, PageHeader, ProgressBar } from "../../components/ui/Feedback";
import { Field, Input, Select } from "../../components/ui/Field";
import { RelativeTime } from "../../components/ui/RelativeTime";
import { Table } from "../../components/ui/Table";
import { useToast } from "../../components/ui/Toast";
import { cx } from "../../lib/cx";

const BUSY = new Set(["validating", "converting", "simulating"]);
const POLL_MS = 2000;
const fileInputClass =
  "block w-full text-sm text-muted file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-surface-raised file:px-3 file:text-sm file:font-medium file:text-fg hover:file:border-border-strong disabled:opacity-50";

type Phase = { kind: "idle" } | { kind: "uploading"; step: string; progress: number } | { kind: "error"; error: unknown };

function issueCodes(s: StructureOut): string[] {
  return [...new Set((s.issues ?? []).map((i) => String(i.code ?? "")).filter(Boolean))];
}

function UploadForm() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);
  const [format, setFormat] = useState<StructureFormat>("oxdna");
  const [name, setName] = useState("");
  const [designId, setDesignId] = useState("");
  const [main, setMain] = useState<File | null>(null); // oxDNA topology or caDNAno JSON
  const [configuration, setConfiguration] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [done, setDone] = useState<StructureOut | null>(null);

  const ready = Boolean(main && name.trim() && (format === "cadnano" || configuration));
  const uploading = phase.kind === "uploading";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !main || uploading) return;
    setDone(null);
    try {
      const first = format === "oxdna" ? "Uploading topology" : "Uploading caDNAno file";
      setPhase({ kind: "uploading", step: first, progress: 0 });
      const params = { name: name.trim(), format, designId: designId.trim() || undefined };
      let structure = await uploadStructure(main, params, (p) => setPhase({ kind: "uploading", step: first, progress: p })).promise;
      if (format === "oxdna" && configuration) {
        const step = "Uploading configuration";
        setPhase({ kind: "uploading", step, progress: 0 });
        structure = await uploadStructureConfiguration(structure.id, configuration, (p) =>
          setPhase({ kind: "uploading", step, progress: p }),
        ).promise;
      }
      setDone(structure);
      toast(`Imported “${structure.name}”`);
      setPhase({ kind: "idle" });
      setMain(null);
      setConfiguration(null);
      setName("");
      form.current?.reset();
    } catch (error) {
      setPhase({ kind: "error", error });
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["structures"] });
    }
  }

  return (
    <Card
      title="Import structure"
      icon={<UploadCloud className="size-4" />}
      description="oxDNA (topology, then configuration) supplies nucleotide coordinates. caDNAno JSON is topology only; it can be converted to an initial oxDNA geometry when tacoxDNA is installed. Imported files are validated, never modified, and are not evidence that a design folds."
    >
      <form ref={form} onSubmit={submit} className="space-y-4">
        <fieldset disabled={uploading}>
          <legend className="mb-1.5 text-xs font-medium text-muted">Format</legend>
          <div className="inline-flex gap-0.5 rounded-lg border border-border bg-surface-sunken p-0.5">
            {(["oxdna", "cadnano"] as const).map((f) => (
              <label
                key={f}
                className={cx(
                  "cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary",
                  format === f ? "bg-primary-strong text-primary-fg" : "text-muted hover:text-fg",
                )}
              >
                <input
                  type="radio"
                  name="structure-format"
                  className="sr-only"
                  checked={format === f}
                  onChange={() => {
                    setFormat(f);
                    setMain(null);
                    setConfiguration(null);
                    form.current?.querySelectorAll<HTMLInputElement>("input[type=file]").forEach((i) => (i.value = ""));
                  }}
                />
                {f === "oxdna" ? "oxDNA" : "caDNAno"}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={format === "oxdna" ? "Topology file (.top)" : "caDNAno file (.json)"}>
            <input
              type="file"
              accept={format === "oxdna" ? ".top,.txt" : ".json"}
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setMain(f);
                if (f) setName((n) => n || f.name.replace(/\.[^.]+$/, ""));
              }}
              className={fileInputClass}
            />
          </Field>
          {format === "oxdna" && (
            <Field label="Configuration file (.dat / .conf)">
              <input
                type="file"
                accept=".dat,.conf,.oxdna,.txt"
                disabled={uploading}
                onChange={(e) => setConfiguration(e.target.files?.[0] ?? null)}
                className={fileInputClass}
              />
            </Field>
          )}
          <Field label="Name">
            <Input value={name} maxLength={200} disabled={uploading} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Linked design id (optional)">
            <Input
              value={designId}
              maxLength={24}
              disabled={uploading}
              placeholder="from a design page URL"
              onChange={(e) => setDesignId(e.target.value)}
              className="font-mono text-xs"
            />
          </Field>
        </div>
        <Button type="submit" variant="primary" icon={<FileUp aria-hidden className="size-4" />} disabled={!ready || uploading} loading={uploading}>
          {uploading ? "Uploading…" : "Import"}
        </Button>
      </form>
      {phase.kind === "uploading" && (
        <div className="mt-4 space-y-1.5">
          <ProgressBar value={phase.progress} max={1} label={phase.step} />
          <p role="status" className="font-mono text-xs text-muted">
            {phase.step}: {Math.round(phase.progress * 100)}%
          </p>
        </div>
      )}
      {phase.kind === "error" && (
        <div className="mt-4">
          <ErrorMessage error={phase.error} />
        </div>
      )}
      {done && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-fg">
          <CircleCheck aria-hidden className="size-4 text-success" />
          Imported “{done.name}”; validation is running. Its status appears in the list below.
        </p>
      )}
    </Card>
  );
}

function ConfigurationUpload({ structure }: { structure: StructureOut }) {
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: (file: File) => uploadStructureConfiguration(structure.id, file).promise,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["structures"] }),
  });
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted">Configuration file:</span>
      <input
        type="file"
        aria-label={`Configuration for ${structure.name}`}
        disabled={upload.isPending}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
        }}
        className={fileInputClass}
      />
      {upload.error && <ErrorMessage error={upload.error} />}
    </label>
  );
}

function ConvertControl({ structure }: { structure: StructureOut }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [lattice, setLattice] = useState<"square" | "honeycomb">("square");
  const convert = useMutation({
    mutationFn: () => api.convertStructure(structure.id, lattice),
    onSuccess: () => toast(`Conversion started (${lattice} lattice)`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["structures"] }),
  });
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Select
        value={lattice}
        aria-label={`Lattice for ${structure.name}`}
        onChange={(e) => setLattice(e.target.value as "square" | "honeycomb")}
        className="h-8 w-32 text-xs"
      >
        <option value="square">square</option>
        <option value="honeycomb">honeycomb</option>
      </Select>
      <Button size="sm" icon={<Shuffle aria-hidden className="size-3.5" />} disabled={convert.isPending} onClick={() => convert.mutate()}>
        Convert to oxDNA
      </Button>
      {convert.error && <ErrorMessage error={convert.error} />}
    </div>
  );
}

export function StructuresPage() {
  const { token } = useToken();
  const structures = useQuery({
    queryKey: ["structures", "list"],
    queryFn: () => api.listStructures(),
    enabled: Boolean(token),
    refetchInterval: (q) => (q.state.data?.items.some((s) => BUSY.has(s.status)) ? POLL_MS : false),
  });
  const tools = useQuery({
    queryKey: ["structures", "tools"],
    queryFn: api.getStructureTools,
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const canConvert = tools.data?.tacoxdna.available === true;

  const header = (
    <PageHeader
      title="Structures"
      description="Import oxDNA or caDNAno files, check their validation status and open them in the 3D viewer."
    />
  );
  if (!token)
    return (
      <div className="space-y-6">
        {header}
        <EmptyState icon={<KeyRound className="size-5" />} title="Set an API token in the sidebar." />
      </div>
    );
  return (
    <div className="space-y-6">
      {header}
      <UploadForm />
      <Card title="Structures" icon={<Shapes className="size-4" />}>
        {tools.data && !canConvert && (
          <Callout tone="neutral" icon={<Shuffle />} className="mb-4 text-xs">
            caDNAno → oxDNA conversion is unavailable: {tools.data.tacoxdna.message ?? "tacoxDNA is not installed."}
          </Callout>
        )}
        {structures.isPending && <LoadingBlock label="Loading structures…" rows={4} />}
        {structures.error && <ErrorMessage error={structures.error} onRetry={() => void structures.refetch()} />}
        {structures.data && structures.data.items.length === 0 && (
          <EmptyState icon={<Shapes className="size-5" />} title="No structures imported yet.">
            Import an oxDNA topology and configuration, or a caDNAno design, above.
          </EmptyState>
        )}
        {structures.data && structures.data.items.length > 0 && (
          <Table>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Format</th>
                  <th>Status</th>
                  <th>Origin</th>
                  <th>Issues</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {structures.data.items.map((s) => {
                  const codes = issueCodes(s);
                  return (
                    <tr key={s.id} className="align-top">
                      <td>
                        <span className="font-medium">{s.name}</span>
                        {s.design_id && (
                          <Link to={`/designs/${s.design_id}`} className="ml-2 text-xs text-primary underline">
                            design
                          </Link>
                        )}
                      </td>
                      <td className="text-xs text-muted">{s.format === "oxdna" ? "oxDNA" : "caDNAno"}</td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="text-xs text-muted">{s.origin}</td>
                      <td>
                        {codes.length ? (
                          <div className="flex flex-wrap gap-1">
                            {codes.map((c) => (
                              <Badge key={c} tone={c.startsWith("E_") ? "danger" : "warning"} className="font-mono">
                                {c}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs text-muted">
                        <RelativeTime iso={s.created_at} />
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1.5">
                          {s.has_coordinates && s.status === "ready" && (
                            <Link to={`/viewer?structure=${encodeURIComponent(s.id)}`} className={buttonClass("secondary", "sm")}>
                              <Orbit aria-hidden className="size-3.5" />
                              Open in 3D viewer
                            </Link>
                          )}
                          {s.status === "awaiting_configuration" && <ConfigurationUpload structure={s} />}
                          {s.format === "cadnano" && s.status === "topology_only" && canConvert && <ConvertControl structure={s} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Table>
        )}
      </Card>
    </div>
  );
}
