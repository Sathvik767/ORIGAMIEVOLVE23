import { useQuery } from "@tanstack/react-query";
import { Boxes, KeyRound, MousePointerClick, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { api } from "../../api/client";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { ErrorMessage } from "../../components/ErrorMessage";
import { useToken } from "../../components/TokenContext";
import { Card } from "../../components/ui/Card";
import { Callout, EmptyState, LoadingBlock, PageHeader, Skeleton } from "../../components/ui/Feedback";
import { Field, Select } from "../../components/ui/Field";
import { cx } from "../../lib/cx";
import { FitnessValue } from "../batches/FitnessValue";
import { CanvasCard, ModeToggle, Swatch, useSceneColors, type ViewMode } from "./CanvasCard";
import { buildIndexSchematic, MISSING_STRUCTURE } from "./geometry";
import { MolecularView, StructureInfo, StructureStatus } from "./MolecularPanel";
import type { SceneHandle } from "./sceneTypes";

// Three.js is only downloaded when a scene is actually shown.
const Scene3D = lazy(() => import("./Scene3D").then((m) => ({ default: m.Scene3D })));

type Source = "design" | "job" | "structure";
const SOURCES: { value: Source; label: string }[] = [
  { value: "design", label: "Dataset design" },
  { value: "job", label: "Completed optimization job" },
  { value: "structure", label: "Imported structure" },
];

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
    <Card title="Choose what to visualize" icon={<SlidersHorizontal className="size-4" />} bodyClassName="space-y-4 p-5">
      <div role="radiogroup" aria-label="Source" className="flex flex-col gap-1">
        {SOURCES.map((s) => (
          <label
            key={s.value}
            className={cx(
              "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors duration-150",
              source === s.value ? "border-primary/40 bg-primary-soft text-fg" : "border-border text-muted hover:text-fg",
            )}
          >
            <input type="radio" name="viewer-source" checked={source === s.value} onChange={() => setSource(s.value)} />
            {s.label}
          </label>
        ))}
      </div>
      {error && <ErrorMessage error={error} />}
      {source === "design" ? (
        <>
          <Field label="Dataset">
            <Select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              <option value="">choose…</option>
              {ready.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Design">
            <Select
              value={params.get("design") ?? ""}
              disabled={!datasetId}
              onChange={(e) => setParams(e.target.value ? { design: e.target.value } : {})}
            >
              <option value="">{designs.isFetching ? "Loading…" : "choose…"}</option>
              {(designs.data?.items ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.external_id}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : source === "structure" ? (
        <Field label="Structure (oxDNA or caDNAno import)">
          <Select value={params.get("structure") ?? ""} onChange={(e) => setParams(e.target.value ? { structure: e.target.value } : {})}>
            <option value="">{structures.isFetching ? "Loading…" : structures.data?.items.length ? "choose…" : "no structures imported"}</option>
            {(structures.data?.items ?? []).map((st) => (
              <option key={st.id} value={st.id}>
                {st.name} ({st.format}, {st.origin}, {st.status.replaceAll("_", " ")})
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <>
          <Field label="Batch">
            <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">choose…</option>
              {(batches.data?.items ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name ?? b.id}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Completed job">
            <Select value={params.get("job") ?? ""} disabled={!batchId} onChange={(e) => setParams(e.target.value ? { job: e.target.value } : {})}>
              <option value="">{jobs.isFetching ? "Loading…" : completed.length || !batchId ? "choose…" : "no completed jobs"}</option>
              {completed.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.external_id ?? j.id}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
    </Card>
  );
}

export function ViewerPage() {
  const { token } = useToken();
  const [params] = useSearchParams();
  const colors = useSceneColors();
  const jobId = params.get("job") ?? "";
  const structureParam = params.get("structure") ?? "";
  const sceneRef = useRef<SceneHandle>(null);
  const [mode, setMode] = useState<ViewMode>("molecular");
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
  const modeToggle = molecular.data ? <ModeToggle mode={mode} onMode={setMode} /> : undefined;

  const header = (
    <PageHeader
      title="3D Viewer"
      description="Imported oxDNA coordinates when available; otherwise an index-space schematic built only from the supplied helix/start/end values."
    />
  );
  if (!token)
    return (
      <div className="space-y-6">
        {header}
        <EmptyState icon={<KeyRound className="size-5" />} title="Set an API token in the sidebar to use the viewer." />
      </div>
    );

  return (
    <div className="space-y-6">
      {header}
      <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Selector />
          {showMolecular && structure && molecular.data && <StructureInfo structure={structure} geometry={molecular.data} />}
          {design.data && !showMolecular && (
            <Card as="aside" title="Design" icon={<Boxes className="size-4" />} bodyClassName="space-y-4 p-5">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted">Design ID</dt>
                <dd className="font-mono text-xs leading-5 break-all">{design.data.external_id}</dd>
                {design.data.name && (
                  <>
                    <dt className="text-muted">Name</dt>
                    <dd>{design.data.name}</dd>
                  </>
                )}
                <dt className="text-muted">Scaffold</dt>
                <dd>{design.data.scaffold ? `${design.data.scaffold.sequence.length} nt (sequence only)` : "none supplied"}</dd>
                <dt className="text-muted">Staples</dt>
                <dd className="font-mono">{design.data.staples.length}</dd>
                <dt className="text-muted">Positioned</dt>
                <dd>{geometry ? `${geometry.placedCount} of ${geometry.stapleCount} staples` : "0 staples"}</dd>
                <dt className="text-muted">Helices</dt>
                <dd className="font-mono">{geometry ? geometry.lanes.length : "—"}</dd>
                {Object.entries(design.data.metadata).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="break-all">{String(v)}</dd>
                  </div>
                ))}
              </dl>
              <Link to={`/designs/${design.data.id}`} className="text-sm font-medium text-primary underline">
                Full design details
              </Link>

              {result.data && (
                <div className="border-t border-border pt-4">
                  <h3 className="text-sm font-semibold text-fg">Optimization result</h3>
                  <p className="mt-1 text-sm">
                    Best fitness <FitnessValue fitness={result.data.fitness_function.name} score={result.data.best_fitness} />
                  </p>
                  <p className="text-xs text-accent">
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
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {error && <ErrorMessage error={error} />}
          {jobId && job.data && job.data.status !== "completed" && (
            <Callout role="alert" tone="warning" icon={<TriangleAlert />}>
              This job is {job.data.status}; only completed jobs have results to show.
            </Callout>
          )}
          {!designId && !jobId && !structureParam && (
            <EmptyState icon={<MousePointerClick className="size-5" />} title="Nothing selected yet" className="py-16">
              Select a dataset design, a completed job or an imported structure to visualize.
            </EmptyState>
          )}
          {structure && !molecular.data && <StructureStatus structure={structure} />}
          {showMolecular && structure && molecular.data && (
            <MolecularView structure={structure} geometry={molecular.data} sceneRef={sceneRef} jobId={jobId} modeToggle={modeToggle} />
          )}
          {loading && !error && <LoadingBlock label="Loading design…" rows={6} />}

          {design.data &&
            !showMolecular &&
            (geometry ? (
              <CanvasCard
                headingId="viewer-heading"
                title="3D view"
                sceneRef={sceneRef}
                modeToggle={modeToggle}
                note={
                  <p role="note" className="rounded-lg border border-info/30 bg-surface/90 px-3 py-1.5 text-xs font-semibold text-fg shadow-sm backdrop-blur">
                    Index-space schematic, not a molecular structure.
                  </p>
                }
                legend={
                  <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1">
                    {result.data ? (
                      <>
                        <Swatch color={colors.bars["selected-variant"]}>staple: optimizer chose a supplied variant</Swatch>
                        <Swatch color={colors.bars.original}>staple: original sequence kept</Swatch>
                        <Swatch color={colors.bars["not-optimized"]}>staple: no variants (fixed)</Swatch>
                      </>
                    ) : (
                      <Swatch color={colors.bars.original}>staple</Swatch>
                    )}
                    <li className="text-subtle">scaffold and crossovers: not drawn (no routing data)</li>
                  </ul>
                }
                footer={
                  <div className="grid gap-3 md:grid-cols-2">
                    <p>
                      Each lane is a helix index from your data and each bar spans a staple&apos;s start–end positions. Lane spacing and depth are
                      display choices, not physical distances. Drag to rotate · scroll to zoom · right-drag to pan.
                    </p>
                    <div>
                      <p className="font-semibold text-fg">Not available in the current data:</p>
                      <ul className="mt-1 list-disc pl-5">
                        {MISSING_STRUCTURE.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                }
              >
                <ErrorBoundary
                  key={design.data.id}
                  fallback={(e) => (
                    <p role="alert" className="p-4 pt-24 text-sm text-danger">
                      3D rendering is unavailable in this browser ({e.message}). Check that WebGL is enabled.
                    </p>
                  )}
                >
                  <Suspense
                    fallback={
                      <div className="absolute inset-0 p-6 pt-24">
                        <span className="sr-only">Loading 3D renderer…</span>
                        <Skeleton className="h-full w-full rounded-lg" />
                      </div>
                    }
                  >
                    {/* key: a new design remounts the scene, which disposes the previous GPU resources */}
                    <Scene3D key={`${design.data.id}:${jobId}`} ref={sceneRef} geometry={geometry} background={colors.background} guide={colors.guide} colors={colors.bars} />
                  </Suspense>
                </ErrorBoundary>
              </CanvasCard>
            ) : (
              <Card title="3D view" icon={<Boxes className="size-4" />}>
                <Callout role="status" tone="warning" icon={<TriangleAlert />} title="No structural data to draw for this design.">
                  None of its staples has helix, start and end positions, so even an index-space schematic can&apos;t be built. Supply
                  those CSV columns (see docs/input-formats.md) to see a schematic.
                </Callout>
                <div className="mt-4 text-xs text-muted">
                  <p className="font-semibold text-fg">Not available in the current data:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {MISSING_STRUCTURE.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              </Card>
            ))}
        </div>
      </div>
    </div>
  );
}
