import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useToken } from "../../components/TokenContext";
import { formatDate } from "../../lib/format";

const BUSY = new Set(["validating", "converting", "simulating"]);
const POLL_MS = 2000;

type Phase = { kind: "idle" } | { kind: "uploading"; step: string; progress: number } | { kind: "error"; error: unknown };

const STATUS_STYLE: Record<string, string> = {
  ready: "bg-emerald-100 text-emerald-800",
  topology_only: "bg-sky-100 text-sky-800",
  invalid: "bg-red-100 text-red-800",
};

function StructureStatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

function issueCodes(s: StructureOut): string[] {
  return [...new Set((s.issues ?? []).map((i) => String(i.code ?? "")).filter(Boolean))];
}

function UploadForm() {
  const queryClient = useQueryClient();
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
    <section aria-labelledby="structure-upload-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="structure-upload-heading" className="mb-1 text-lg font-semibold text-slate-800">
        Import structure
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        oxDNA (topology, then configuration) supplies nucleotide coordinates. caDNAno JSON is topology only; it can be
        converted to an initial oxDNA geometry when tacoxDNA is installed. Imported files are validated, never modified,
        and are not evidence that a design folds.
      </p>
      <form ref={form} onSubmit={submit} className="space-y-3">
        <fieldset className="flex gap-4 text-sm" disabled={uploading}>
          <legend className="sr-only">Format</legend>
          {(["oxdna", "cadnano"] as const).map((f) => (
            <label key={f} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="structure-format"
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
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">{format === "oxdna" ? "Topology file (.top)" : "caDNAno file (.json)"}</span>
            <input
              type="file"
              accept={format === "oxdna" ? ".top,.txt" : ".json"}
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setMain(f);
                if (f) setName((n) => n || f.name.replace(/\.[^.]+$/, ""));
              }}
              className="text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1"
            />
          </label>
          {format === "oxdna" && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600">Configuration file (.dat / .conf)</span>
              <input
                type="file"
                accept=".dat,.conf,.oxdna,.txt"
                disabled={uploading}
                onChange={(e) => setConfiguration(e.target.files?.[0] ?? null)}
                className="text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Name</span>
            <input
              value={name}
              maxLength={200}
              disabled={uploading}
              onChange={(e) => setName(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Linked design id (optional)</span>
            <input
              value={designId}
              maxLength={24}
              disabled={uploading}
              placeholder="from a design page URL"
              onChange={(e) => setDesignId(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={!ready || uploading}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {uploading ? "Uploading…" : "Import"}
        </button>
      </form>
      {phase.kind === "uploading" && (
        <p role="status" className="mt-3 text-sm text-slate-600">
          {phase.step}: {Math.round(phase.progress * 100)}%
        </p>
      )}
      {phase.kind === "error" && (
        <div className="mt-3">
          <ErrorMessage error={phase.error} />
        </div>
      )}
      {done && (
        <p role="status" className="mt-3 text-sm text-emerald-800">
          Imported “{done.name}”; validation is running. Its status appears in the list below.
        </p>
      )}
    </section>
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
      <span className="text-slate-600">Configuration file:</span>
      <input
        type="file"
        aria-label={`Configuration for ${structure.name}`}
        disabled={upload.isPending}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
        }}
        className="text-xs"
      />
      {upload.error && <ErrorMessage error={upload.error} />}
    </label>
  );
}

function ConvertControl({ structure }: { structure: StructureOut }) {
  const queryClient = useQueryClient();
  const [lattice, setLattice] = useState<"square" | "honeycomb">("square");
  const convert = useMutation({
    mutationFn: () => api.convertStructure(structure.id, lattice),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["structures"] }),
  });
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <select
        value={lattice}
        aria-label={`Lattice for ${structure.name}`}
        onChange={(e) => setLattice(e.target.value as "square" | "honeycomb")}
        className="rounded border border-slate-300 px-1 py-0.5"
      >
        <option value="square">square</option>
        <option value="honeycomb">honeycomb</option>
      </select>
      <button
        type="button"
        disabled={convert.isPending}
        onClick={() => convert.mutate()}
        className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
      >
        Convert to oxDNA
      </button>
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

  if (!token) return <p className="text-sm text-slate-500">Set an API token in the header.</p>;
  return (
    <div className="space-y-6">
      <UploadForm />
      <section aria-labelledby="structures-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 id="structures-heading" className="mb-1 text-lg font-semibold text-slate-800">
          Structures
        </h2>
        {tools.data && !canConvert && (
          <p className="mb-3 text-xs text-slate-500">
            caDNAno → oxDNA conversion is unavailable: {tools.data.tacoxdna.message ?? "tacoxDNA is not installed."}
          </p>
        )}
        {structures.isPending && <p className="text-sm text-slate-500">Loading…</p>}
        {structures.error && <ErrorMessage error={structures.error} />}
        {structures.data && structures.data.items.length === 0 && (
          <p className="text-sm text-slate-500">No structures imported yet.</p>
        )}
        {structures.data && structures.data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Format</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Origin</th>
                  <th className="py-2 pr-4">Issues</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {structures.data.items.map((s) => {
                  const codes = issueCodes(s);
                  return (
                    <tr key={s.id} className="border-b border-slate-100 align-top last:border-0">
                      <td className="py-2 pr-4">
                        {s.name}
                        {s.design_id && (
                          <Link to={`/designs/${s.design_id}`} className="ml-2 text-xs text-slate-500 underline">
                            design
                          </Link>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-xs">{s.format === "oxdna" ? "oxDNA" : "caDNAno"}</td>
                      <td className="py-2 pr-4">
                        <StructureStatusBadge status={s.status} />
                      </td>
                      <td className="py-2 pr-4 text-xs">{s.origin}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{codes.length ? codes.join(", ") : "—"}</td>
                      <td className="py-2 pr-4 text-xs text-slate-500">{formatDate(s.created_at)}</td>
                      <td className="py-2">
                        <div className="flex flex-col gap-1">
                          {s.has_coordinates && s.status === "ready" && (
                            <Link to={`/viewer?structure=${encodeURIComponent(s.id)}`} className="text-xs underline">
                              Open in 3D viewer
                            </Link>
                          )}
                          {s.status === "awaiting_configuration" && <ConfigurationUpload structure={s} />}
                          {s.format === "cadnano" && s.status === "topology_only" && canConvert && (
                            <ConvertControl structure={s} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
