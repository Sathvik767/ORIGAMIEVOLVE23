import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { api } from "../../api/client";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { ErrorMessage } from "../../components/ErrorMessage";
import { useToken } from "../../components/TokenContext";
import { formatFitness } from "../batches/status";
import { buildIndexSchematic, MISSING_STRUCTURE } from "./geometry";
import { MolecularPanel, StructureStatus } from "./MolecularPanel";
import { BAR_COLORS, type SceneHandle } from "./sceneTypes";

// Three.js is only downloaded when a scene is actually shown.
const Scene3D = lazy(() => import("./Scene3D").then((m) => ({ default: m.Scene3D })));

type Source = "design" | "job" | "structure";

function Selector() {
  const { token } = useToken();
  const [params, setParams] = useSearchParams();
  const [source, setSource] = useState<Source>(params.get("job") ? "job" : params.get("structure") ? "structure" : "design");
  const [datasetId, setDatasetId] = useState("");
  const [batchId, setBatchId] = useState("");

  const datasets = useQuery({ queryKey: ["datasets", "list"], queryFn: () => api.listDatasets(), enabled: Boolean(token) });
  const designs = useQuery({
    queryKey: ["datasets", datasetId, "designs", "viewer"],
    queryFn: () => api.listDesigns(datasetId),
    enabled: Boolean(token && datasetId),
  });
  const batches = useQuery({
    queryKey: ["batches", "list"],
    queryFn: () => api.listBatches(),
    enabled: Boolean(token && source === "job"),
  });
  const jobs = useQuery({
    queryKey: ["batches", batchId, "jobs"],
    queryFn: () => api.listBatchJobs(batchId),
    enabled: Boolean(token && batchId),
  });
  const structures = useQuery({
    queryKey: ["structures", "list"],
    queryFn: () => api.listStructures(),
    enabled: Boolean(token && source === "structure"),
  });
  const ready = (datasets.data?.items ?? []).filter((d) => d.status === "ready" || d.status === "ready_with_errors");
  const completed = (jobs.data?.items ?? []).filter((j) => j.status === "completed");
  const error = datasets.error ?? designs.error ?? batches.error ?? jobs.error ?? structures.error;

  return (
    <section aria-labelledby="viewer-select-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="viewer-select-heading" className="mb-3 text-lg font-semibold text-slate-800">
        Choose what to visualize
      </h2>
      <div role="radiogroup" aria-label="Source" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {(["design", "job", "structure"] as const).map((s) => (
          <label key={s} className="flex items-center gap-1.5">
            <input type="radio" name="viewer-source" checked={source === s} onChange={() => setSource(s)} />
            {s === "design" ? "Dataset design" : s === "job" ? "Completed optimization job" : "Imported structure"}
          </label>
        ))}
      </div>
      {error && <ErrorMessage error={error} />}
      {source === "design" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Dataset</span>
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
              <option value="">choose…</option>
              {ready.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Design</span>
            <select
              value={params.get("design") ?? ""}
              disabled={!datasetId}
              onChange={(e) => setParams(e.target.value ? { design: e.target.value } : {})}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="">{designs.isFetching ? "Loading…" : "choose…"}</option>
              {(designs.data?.items ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.external_id}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : source === "structure" ? (
        <label className="flex flex-col gap-1 text-sm sm:w-1/2">
          <span className="text-slate-600">Structure (oxDNA or caDNAno import)</span>
          <select
            value={params.get("structure") ?? ""}
            onChange={(e) => setParams(e.target.value ? { structure: e.target.value } : {})}
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="">{structures.isFetching ? "Loading…" : structures.data?.items.length ? "choose…" : "no structures imported"}</option>
            {(structures.data?.items ?? []).map((st) => (
              <option key={st.id} value={st.id}>
                {st.name} ({st.format}, {st.origin}, {st.status.replaceAll("_", " ")})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Batch</span>
            <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
              <option value="">choose…</option>
              {(batches.data?.items ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name ?? b.id}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Completed job</span>
            <select
              value={params.get("job") ?? ""}
              disabled={!batchId}
              onChange={(e) => setParams(e.target.value ? { job: e.target.value } : {})}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="">{jobs.isFetching ? "Loading…" : completed.length || !batchId ? "choose…" : "no completed jobs"}</option>
              {completed.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.external_id ?? j.id}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </section>
  );
}

export function ViewerPage() {
  const { token } = useToken();
  const [params] = useSearchParams();
  const jobId = params.get("job") ?? "";
  const structureParam = params.get("structure") ?? "";
  const sceneRef = useRef<SceneHandle>(null);
  const [mode, setMode] = useState<"molecular" | "schematic">("molecular");
  const chosenStructure = useQuery({
    queryKey: ["structures", structureParam],
    queryFn: () => api.getStructure(structureParam),
    enabled: Boolean(token && structureParam),
  });

  const job = useQuery({ queryKey: ["jobs", jobId], queryFn: () => api.getJob(jobId), enabled: Boolean(token && jobId) });
  const result = useQuery({
    queryKey: ["jobs", jobId, "result"],
    queryFn: () => api.getJobResult(jobId),
    enabled: Boolean(token && jobId && job.data?.status === "completed"),
    staleTime: Infinity,
  });
  const designId = jobId
    ? (job.data?.design_id ?? "")
    : structureParam
      ? (chosenStructure.data?.design_id ?? "")
      : (params.get("design") ?? "");
  const linked = useQuery({
    queryKey: ["structures", "for-design", designId],
    queryFn: () => api.listStructures(designId),
    enabled: Boolean(token && designId && !structureParam),
  });
  // An explicitly chosen structure wins; otherwise prefer a linked structure that has coordinates.
  const structure = structureParam
    ? chosenStructure.data
    : (linked.data?.items.find((st) => st.has_coordinates) ?? linked.data?.items[0]);
  const molecular = useQuery({
    queryKey: ["structures", structure?.id, "geometry", jobId],
    queryFn: () => api.getStructureGeometry(structure!.id, jobId && job.data?.status === "completed" ? jobId : undefined),
    enabled: Boolean(token && structure?.has_coordinates && (!jobId || job.data?.status === "completed")),
    staleTime: Infinity,
  });
  const showMolecular = mode === "molecular" && Boolean(molecular.data);
  const design = useQuery({
    queryKey: ["designs", designId],
    queryFn: () => api.getDesign(designId),
    enabled: Boolean(token && designId),
  });
  const geometry = useMemo(
    () => (design.data ? buildIndexSchematic(design.data, result.data?.selected_variants) : null),
    [design.data, result.data],
  );
  const error = job.error ?? result.error ?? design.error ?? chosenStructure.error ?? molecular.error;
  const loading = (jobId && job.isPending) || (designId && design.isPending) || (jobId && job.data?.status === "completed" && result.isPending);
  const changed = result.data?.selected_variants.filter((v) => !v.is_original) ?? [];

  if (!token) return <p className="text-sm text-slate-500">Set an API token in the header to use the viewer.</p>;

  return (
    <div className="space-y-6">
      <Selector />
      {error && <ErrorMessage error={error} />}
      {jobId && job.data && job.data.status !== "completed" && (
        <p role="alert" className="text-sm text-amber-800">This job is {job.data.status}; only completed jobs have results to show.</p>
      )}
      {!designId && !jobId && !structureParam && (
        <p className="text-sm text-slate-500">Select a dataset design, a completed job or an imported structure to visualize.</p>
      )}
      {structure && (
        <StructureStatus structure={structure} mode={mode} onMode={setMode} available={Boolean(molecular.data)} />
      )}
      {showMolecular && structure && molecular.data && (
        <MolecularPanel structure={structure} geometry={molecular.data} sceneRef={sceneRef} jobId={jobId} />
      )}
      {loading && !error && <p className="text-sm text-slate-500">Loading design…</p>}

      {design.data && !showMolecular && (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <section aria-labelledby="viewer-heading" className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="viewer-heading" className="text-lg font-semibold text-slate-800">
                3D view
              </h2>
              {geometry && (
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => sceneRef.current?.zoom(1.25)} className="rounded border border-slate-300 px-2 py-0.5">
                    Zoom in
                  </button>
                  <button type="button" onClick={() => sceneRef.current?.zoom(0.8)} className="rounded border border-slate-300 px-2 py-0.5">
                    Zoom out
                  </button>
                  <button type="button" onClick={() => sceneRef.current?.reset()} className="rounded border border-slate-300 px-2 py-0.5">
                    Reset view
                  </button>
                </div>
              )}
            </div>

            {geometry ? (
              <>
                <p role="note" className="mb-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                  <strong>Index-space schematic, not a molecular structure.</strong> Each lane is a helix index from your
                  data and each bar spans a staple's start–end positions. Lane spacing and depth are display choices,
                  not physical distances.
                </p>
                <div className="h-[420px] overflow-hidden rounded border border-slate-100">
                  <ErrorBoundary
                    key={design.data.id}
                    fallback={(e) => (
                      <p role="alert" className="p-4 text-sm text-red-800">
                        3D rendering is unavailable in this browser ({e.message}). Check that WebGL is enabled.
                      </p>
                    )}
                  >
                    <Suspense fallback={<p className="p-4 text-sm text-slate-500">Loading 3D renderer…</p>}>
                      {/* key: a new design remounts the scene, which disposes the previous GPU resources */}
                      <Scene3D key={`${design.data.id}:${jobId}`} ref={sceneRef} geometry={geometry} />
                    </Suspense>
                  </ErrorBoundary>
                </div>
                <p className="mt-2 text-xs text-slate-500">Drag to rotate · scroll to zoom · right-drag to pan.</p>
                <ul aria-label="Legend" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  {result.data ? (
                    <>
                      <li><span className="mr-1 inline-block h-2 w-4 align-middle" style={{ background: BAR_COLORS["selected-variant"] }} />staple: optimizer chose a supplied variant</li>
                      <li><span className="mr-1 inline-block h-2 w-4 align-middle" style={{ background: BAR_COLORS.original }} />staple: original sequence kept</li>
                      <li><span className="mr-1 inline-block h-2 w-4 align-middle" style={{ background: BAR_COLORS["not-optimized"] }} />staple: no variants (fixed)</li>
                    </>
                  ) : (
                    <li><span className="mr-1 inline-block h-2 w-4 align-middle" style={{ background: BAR_COLORS.original }} />staple</li>
                  )}
                  <li className="text-slate-400">scaffold and crossovers: not drawn (no routing data)</li>
                </ul>
              </>
            ) : (
              <div role="status" className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">No structural data to draw for this design.</p>
                <p className="mt-1">
                  None of its staples has helix, start and end positions, so even an index-space schematic can't be
                  built. Supply those CSV columns (see docs/input-formats.md) to see a schematic.
                </p>
              </div>
            )}

            <div className="mt-4 text-xs text-slate-600">
              <p className="font-semibold text-slate-700">Not available in the current data:</p>
              <ul className="mt-1 list-disc pl-5">
                {MISSING_STRUCTURE.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          </section>

          <aside aria-labelledby="viewer-info-heading" className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 id="viewer-info-heading" className="text-lg font-semibold text-slate-800">
              Design
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-500">Design ID</dt>
              <dd className="font-mono text-xs break-all">{design.data.external_id}</dd>
              {design.data.name && (
                <>
                  <dt className="text-slate-500">Name</dt>
                  <dd>{design.data.name}</dd>
                </>
              )}
              <dt className="text-slate-500">Scaffold</dt>
              <dd>{design.data.scaffold ? `${design.data.scaffold.sequence.length} nt (sequence only)` : "none supplied"}</dd>
              <dt className="text-slate-500">Staples</dt>
              <dd>{design.data.staples.length}</dd>
              <dt className="text-slate-500">Positioned</dt>
              <dd>{geometry ? `${geometry.placedCount} of ${geometry.stapleCount} staples` : "0 staples"}</dd>
              <dt className="text-slate-500">Helices</dt>
              <dd>{geometry ? geometry.lanes.length : "—"}</dd>
              {Object.entries(design.data.metadata).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="break-all">{String(v)}</dd>
                </div>
              ))}
            </dl>
            <Link to={`/designs/${design.data.id}`} className="text-sm underline">
              Full design details
            </Link>

            {result.data && (
              <div className="border-t border-slate-100 pt-4">
                <h3 className="text-sm font-semibold text-slate-700">Optimization result</h3>
                <p className="mt-1 text-sm">
                  Best fitness <span className="font-mono">{formatFitness(result.data.best_fitness)}</span>
                </p>
                <p className="text-xs text-amber-800">
                  Computational proxy ({result.data.fitness_function.name}); not evidence of a validated structure.
                </p>
                <p className="mt-2 text-sm">
                  {changed.length} of {result.data.selected_variants.length} optimizable staples use a supplied variant.
                </p>
                <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto font-mono text-xs">
                  {result.data.selected_variants.map((v) => (
                    <li key={v.staple_id}>
                      {v.staple_id}: {v.is_original ? "original" : `variant ${v.choice}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
