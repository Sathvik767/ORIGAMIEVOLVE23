import type { components } from "./schema";

export const API_BASE = "/api/v1";

type Schemas = components["schemas"];
export type DatasetOut = Schemas["DatasetOut"];
export type DatasetStatus = Schemas["DatasetStatus"];
export type DesignFormat = Schemas["DesignFormat"];
export type UploadResult = Schemas["UploadResult"];
export type ReportSummary = Schemas["ReportSummary"];
export type DesignSummary = Schemas["DesignSummary"];
export type DesignOut = Schemas["DesignOut"];
export type DatasetPage = Schemas["Page_DatasetOut_"];
export type DesignPage = Schemas["Page_DesignSummary_"];
export type BatchCreate = Schemas["BatchCreate"];
export type BatchOut = Schemas["BatchOut"];
export type BatchStatus = Schemas["BatchStatus"];
export type BatchPage = Schemas["Page_BatchOut_"];
export type JobOut = Schemas["JobOut"];
export type JobStatus = Schemas["JobStatus"];
export type JobPage = Schemas["Page_JobOut_"];
export type OptimizationResult = Schemas["OptimizationResult"];
export type StructureOut = Schemas["StructureOut"];
export type FitnessFunctionOut = Schemas["FitnessFunctionOut"];
export type RankedCandidate = Schemas["RankedCandidate"];

export interface GenerationPoint {
  generation: number;
  best: number;
  mean: number;
}

/** GET /jobs/{id}/history: recorded per-generation fitness (never filled in when unavailable). */
export interface JobHistory {
  job_id: string;
  status: JobStatus;
  total_generations: number | null;
  source: "result" | "live" | "unavailable";
  history: GenerationPoint[];
  note: string | null;
}

export interface ToolStatus {
  configured: boolean;
  available: boolean;
  setting: string;
  message: string | null;
}
export type StructurePage = Schemas["Page_StructureOut_"];

/** Molecular coordinates served by GET /structures/{id}/geometry (oxDNA, as stored, centred for display). */
export interface MolecularGeometry {
  kind: "molecular";
  source: "oxdna";
  length_unit_nm: number;
  nucleotides: number;
  positions: number[]; // x,y,z per nucleotide, strand by strand, 5'->3'
  strands: {
    index: number;
    offset: number;
    length: number;
    circular: boolean;
    role: "scaffold" | "staple" | "unassigned";
    design_strand_id: string | null;
    variant: { choice: number; is_original: boolean; length_compatible: boolean } | null;
  }[];
  annotated_job_id?: string;
}

/** RFC 9457 problem details as returned by the backend. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: { loc: (string | number)[]; msg: string }[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem?: Problem;

  constructor(status: number, problem?: Problem) {
    super(problem?.detail ?? problem?.title ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}

// --- API token -------------------------------------------------------------
// Kept in sessionStorage (cleared when the tab closes) rather than localStorage.
const TOKEN_KEY = "origami.apiToken";

export function getToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function storeToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: token lives only for this page load */
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    return new ApiError(res.status, (await res.json()) as Problem);
  } catch {
    return new ApiError(res.status);
  }
}

interface RequestOptions {
  acceptStatuses?: number[];
  query?: Record<string, string | undefined>;
  json?: unknown;
  headers?: Record<string, string>;
}

async function request<T>(
  method: string,
  path: string,
  { acceptStatuses = [], query, json, headers }: RequestOptions = {},
): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) params.set(k, v);
  const qs = params.size ? `?${params}` : "";
  const res = await fetch(`${API_BASE}${path}${qs}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
      ...authHeaders(),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  if (res.ok || acceptStatuses.includes(res.status)) {
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
  throw await toApiError(res);
}

export interface ReadinessResponse {
  status: "ok" | "unavailable";
  checks: Record<string, string>;
}

export const api = {
  readiness: () => request<ReadinessResponse>("GET", "/ready", { acceptStatuses: [503] }),
  listDatasets: (cursor?: string) => request<DatasetPage>("GET", "/datasets", { query: { cursor, limit: "25" } }),
  getDataset: (id: string) => request<DatasetOut>("GET", `/datasets/${encodeURIComponent(id)}`),
  getReport: (id: string) => request<ReportSummary>("GET", `/datasets/${encodeURIComponent(id)}/report`),
  listDesigns: (id: string, cursor?: string) =>
    request<DesignPage>("GET", `/datasets/${encodeURIComponent(id)}/designs`, { query: { cursor, limit: "50" } }),
  getDesign: (id: string) => request<DesignOut>("GET", `/designs/${encodeURIComponent(id)}`),
  reingest: (id: string) => request<DatasetOut>("POST", `/datasets/${encodeURIComponent(id)}/ingest`),
  deleteDataset: (id: string) => request<void>("DELETE", `/datasets/${encodeURIComponent(id)}`),

  // Batch optimization (M3 API)
  /** `idempotencyKey` makes a resubmitted request return the original batch instead of creating another. */
  createBatch: (body: BatchCreate, idempotencyKey: string) =>
    request<BatchOut>("POST", "/batches", { json: body, headers: { "Idempotency-Key": idempotencyKey } }),
  listBatches: (cursor?: string) => request<BatchPage>("GET", "/batches", { query: { cursor, limit: "25" } }),
  getBatch: (id: string) => request<BatchOut>("GET", `/batches/${encodeURIComponent(id)}`),
  listBatchJobs: (id: string, cursor?: string) =>
    request<JobPage>("GET", `/batches/${encodeURIComponent(id)}/jobs`, { query: { cursor, limit: "100" } }),
  cancelBatch: (id: string) => request<BatchOut>("POST", `/batches/${encodeURIComponent(id)}/cancel`),
  listFitnessFunctions: () => request<FitnessFunctionOut[]>("GET", "/fitness-functions"),
  listStructures: (designId?: string) =>
    request<StructurePage>("GET", "/structures", { query: { design_id: designId, limit: "50" } }),
  getStructure: (id: string) => request<StructureOut>("GET", `/structures/${encodeURIComponent(id)}`),
  getStructureGeometry: (id: string, jobId?: string) =>
    request<MolecularGeometry>("GET", `/structures/${encodeURIComponent(id)}/geometry`, { query: { job_id: jobId } }),
  getJob: (id: string) => request<JobOut>("GET", `/jobs/${encodeURIComponent(id)}`),
  cancelJob: (id: string) => request<JobOut>("POST", `/jobs/${encodeURIComponent(id)}/cancel`),
  retryJob: (id: string) => request<JobOut>("POST", `/jobs/${encodeURIComponent(id)}/retry`),
  getJobHistory: (id: string) => request<JobHistory>("GET", `/jobs/${encodeURIComponent(id)}/history`),
  getStructureTools: () => request<{ oxdna: ToolStatus; tacoxdna: ToolStatus }>("GET", "/structures/tools"),
  getJobResult: (id: string) => request<OptimizationResult>("GET", `/jobs/${encodeURIComponent(id)}/result`),
};

/** Fetch the full report with auth and hand it to the browser as a file download. */
export async function downloadReport(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/datasets/${encodeURIComponent(id)}/report/download`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw await toApiError(res);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: `validation-${id}.json` });
  a.click();
  URL.revokeObjectURL(url);
}

export interface UploadParams {
  name: string;
  format: DesignFormat;
  description?: string;
}

/**
 * Upload a file as the raw request body (the backend streams it with a size limit).
 * Uses XMLHttpRequest because fetch() cannot report upload progress.
 */
export function uploadDataset(
  file: File,
  params: UploadParams,
  onProgress?: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const query = new URLSearchParams({ name: params.name, format: params.format, filename: file.name });
  if (params.description) query.set("description", params.description);

  const promise = new Promise<UploadResult>((resolve, reject) => {
    xhr.open("POST", `${API_BASE}/datasets?${query}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("Accept", "application/json");
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadResult);
      else reject(new ApiError(xhr.status, body as Problem | undefined));
    };
    xhr.onerror = () => reject(new ApiError(0, { type: "about:blank", title: "Network error", status: 0 }));
    xhr.onabort = () => reject(new ApiError(0, { type: "about:blank", title: "Upload cancelled", status: 0 }));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

export function inferFormat(filename: string): DesignFormat | undefined {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "csv") return "csv";
  if (ext === "ndjson" || ext === "jsonl") return "ndjson";
  if (ext === "json") return "json";
  return undefined;
}
