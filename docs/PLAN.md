# OrigamiEvolve — Technical Plan (pre-implementation)

Status: **DRAFT — awaiting approval.** No application code has been written.
Date: 2026-10-10

---

## 0. Scientific scope statement (read first)

OrigamiEvolve is a **data-management and optimization-orchestration tool**. It is **not** a DNA folding simulator, structure predictor, or stability model.

| Concept | What it means in this system | What it does NOT mean |
|---|---|---|
| **Computational fitness proxy** | A number produced by a registered, versioned plugin function from design data (e.g. sequence-level heuristics such as GC-content deviation from a user-set target). | Evidence that a design folds, is stable, or has a given yield. |
| **Toy benchmark fitness** | A synthetic objective (e.g. Sphere/Rastrigin on a numeric vector) used only to verify GA engine correctness. | Anything about DNA. |
| **Experimental measurement** | A value the *user* imports (e.g. measured yield), stored verbatim with provenance (source, method, date, operator). | Something the system computes, infers, or "validates". |

Rules enforced in code and UI:
1. Every fitness result is stamped with `fitness_function.{name, version, kind}` where `kind ∈ {computational_proxy, toy_benchmark, external}`. There is no `validated` kind the system can assign.
2. Computed proxies and imported measurements live in **separate fields/collections** and are never merged into one score.
3. The UI shows a persistent "Computational proxy — not experimentally validated" label on every fitness chart and result table.
4. Built-in proxies ship with a docstring stating their limitations. No built-in plugin claims to model thermodynamics, folding kinetics, or mechanical stability.
5. Scientifically justified metrics (e.g. a wrapper around an external tool such as a coarse-grained simulator or nearest-neighbour energy package) can be added later via the same plugin interface **once the user supplies and justifies them**.

---

## 1. Architecture

### 1.1 Component diagram

```
┌──────────────────────────┐        HTTPS/JSON, SSE         ┌────────────────────────────┐
│  web (React+TS+Vite+TW)  │ ─────────────────────────────▶ │  api (FastAPI, Pydantic v2)│
│  TanStack Query, Router  │ ◀───────────────────────────── │  uvicorn, async PyMongo    │
│  Recharts, react-three-  │                                └───────┬───────────┬────────┘
│  fiber (Three.js)        │                                        │           │
└──────────────────────────┘                          enqueue task  │           │ read/write
                                                       (JSON only)  ▼           ▼
                                                     ┌──────────────────┐  ┌──────────────┐
                                                     │ Redis (broker,   │  │ MongoDB      │
                                                     │ locks, rate lim.)│  │ metadata,    │
                                                     └────────┬─────────┘  │ jobs, history│
                                                              │            └──────▲───────┘
                                                              ▼                   │
                                              ┌───────────────────────────────┐   │
                                              │ worker (Celery)               │───┘
                                              │  queue "ingest"   (conc. 2)   │
                                              │  queue "optimize" (conc. N)   │──┐
                                              │  beat: reaper, cleanup        │  │
                                              └───────────────────────────────┘  │
                                                                                 ▼
                                                               ┌────────────────────────────┐
                                                               │ File storage (StorageBackend)
                                                               │ local volume (default)     │
                                                               │ S3-compatible (later)      │
                                                               └────────────────────────────┘
```

### 1.2 Responsibilities

- **web** — upload UI, dataset browser, validation-report viewer, experiment builder, job dashboard (live progress), fitness charts, 3D viewer. Types generated from the API's OpenAPI schema (`openapi-typescript`) so frontend/back-end contracts can't silently drift.
- **api** — authentication, request validation, streaming uploads to storage, creating job records, enqueuing tasks, serving reads, SSE progress stream. Never runs CPU-heavy work in-process.
- **worker** — two Celery queues:
  - `ingest`: parses and validates uploaded files in a streaming fashion, writes designs and a validation report.
  - `optimize`: runs one GA job per design. Checkpoints, heartbeats, honours cancellation.
  - `beat`: stale-job reaper and storage cleanup.
- **core library (`origami_core`)** — pure-Python, framework-free package containing domain models, parsers, GA engine, plugin interfaces. Imported by both api and worker. This keeps the scientific/algorithmic code unit-testable without Mongo/Redis/Celery.

### 1.3 Key technology choices

| Area | Choice | Reason |
|---|---|---|
| Python | 3.12 | Mature, good typing; supported by all deps. |
| Mongo driver | PyMongo **async API** (`AsyncMongoClient`) in api; sync PyMongo in worker | Motor is deprecated in favour of PyMongo's native async; Celery tasks are sync. |
| Task queue | Celery 5.x + Redis broker, **JSON serializer only** (no pickle) | Requirement; JSON avoids deserialization RCE. |
| Results backend | None for business data — state lives in MongoDB | Single source of truth; Celery results are ephemeral. |
| GA engine | Own small engine in `origami_core.ga` (NumPy) | Deterministic seeding, checkpointable state, no hidden globals (DEAP uses global creator state). |
| CSV parsing | stdlib `csv` streaming + Pydantic per row, batched inserts | Constant memory; no pandas dependency in the hot path. |
| JSON parsing | NDJSON line-by-line (preferred); JSON arrays via `ijson` | Streaming for both. |
| Charts | Recharts | Per-generation summaries are small (≤ a few thousand points/job); simple, accessible. Switch to ECharts only if overlaying many jobs gets slow. |
| 3D | three.js via `@react-three/fiber` + `drei`, `InstancedMesh` | Instancing keeps 100k+ nucleotides interactive. |
| Styling | Tailwind CSS v4 | Requirement. |
| Errors | RFC 9457 `application/problem+json` | Consistent machine-readable errors. |

### 1.4 Concurrency and failure model (summary; details in §5)

- Bounded concurrency = Celery worker concurrency per queue (`OPTIMIZE_CONCURRENCY`, default 2) × number of worker containers, plus `worker_prefetch_multiplier=1` so workers never hoard tasks.
- Admission control in the API: `MAX_QUEUED_JOBS` (global) and `MAX_JOBS_PER_EXPERIMENT`; exceeding them returns `429` / `422` rather than an unbounded backlog.
- `task_acks_late=True` + `task_reject_on_worker_lost=True` so a crashed worker's task is redelivered; idempotent task design (§5.4) makes redelivery safe.
- Soft/hard time limits per task; soft limit triggers a graceful checkpoint + `failed(reason=timeout)`.

### 1.5 Windows / local-dev note

Celery's worker is not supported natively on Windows. Local dev therefore runs **api + worker inside Docker Compose** (or WSL2). The frontend runs natively with `npm run dev`. Compose profiles:
- `deps` — mongo, redis only (for running api/tests on Linux/macOS/WSL hosts).
- `full` — deps + api + worker + beat.

---

## 2. Repository structure

```
origami-evolve/
├── README.md                    # setup, quickstart, scientific-scope statement
├── docs/
│   ├── PLAN.md                  # this document
│   ├── architecture.md          # §1 expanded, kept current
│   ├── input-formats.md         # canonical schemas + examples (§4.3)
│   ├── fitness-plugins.md       # how to write/register a fitness plugin
│   ├── job-lifecycle.md         # state machine (§5)
│   └── adr/                     # architecture decision records
├── docker-compose.yml           # mongo, redis (+ api, worker, beat under profile "full")
├── .env.example                 # every config var, documented, safe defaults
├── Makefile / justfile          # dev, test, lint, fmt shortcuts (with PowerShell equivalents in README)
├── backend/
│   ├── pyproject.toml           # uv/pip-tools managed; ruff, mypy, pytest config
│   ├── Dockerfile               # multi-stage, non-root user
│   ├── src/
│   │   ├── origami_core/        # PURE library — no FastAPI/Mongo/Celery imports
│   │   │   ├── models/          # Design, Strand, Geometry, GenomeSpec (Pydantic)
│   │   │   ├── ingest/          # csv_reader.py, ndjson_reader.py, json_array_reader.py,
│   │   │   │                    # validators.py, report.py (ValidationReport builder)
│   │   │   ├── ga/              # engine.py, operators/ (selection, crossover, mutation),
│   │   │   │                    # population.py, rng.py, checkpoint.py
│   │   │   ├── encodings/       # base.py (Encoding protocol), candidate_selection.py,
│   │   │   │                    # real_vector.py
│   │   │   ├── fitness/         # base.py (FitnessFunction protocol), registry.py,
│   │   │   │                    # proxies/sequence_heuristics.py, benchmarks/toy.py
│   │   │   └── storage/         # base.py (StorageBackend protocol), local.py, s3.py (later)
│   │   ├── origami_api/
│   │   │   ├── main.py          # app factory, middleware, lifespan
│   │   │   ├── config.py        # pydantic-settings
│   │   │   ├── security.py      # API-token auth, CORS, headers, rate limiting
│   │   │   ├── db.py            # AsyncMongoClient, index bootstrap
│   │   │   ├── routers/         # health, datasets, designs, plugins, experiments, jobs
│   │   │   ├── schemas/         # request/response DTOs (separate from domain models)
│   │   │   ├── repositories/    # all Mongo access; no raw user dicts reach queries
│   │   │   └── services/        # upload streaming, job admission, SSE
│   │   └── origami_worker/
│   │       ├── celery_app.py    # config: JSON only, acks_late, prefetch=1, routes
│   │       ├── tasks/           # ingest.py, optimize.py, maintenance.py
│   │       ├── job_state.py     # atomic state transitions (compare-and-set)
│   │       └── progress.py      # heartbeat + per-generation writes
│   └── tests/
│       ├── unit/                # core only, no services
│       ├── integration/         # api+mongo+redis (testcontainers or compose "deps")
│       ├── e2e/                 # upload → ingest → launch → complete, real worker
│       └── fixtures/            # small valid/invalid CSV, NDJSON, JSON files
└── frontend/
    ├── package.json             # Node 22 LTS
    ├── vite.config.ts
    ├── tsconfig.json            # strict
    ├── index.html
    ├── src/
    │   ├── main.tsx, App.tsx, routes.tsx
    │   ├── api/                 # generated OpenAPI types + typed fetch client
    │   ├── features/
    │   │   ├── datasets/        # UploadPanel, DatasetList, ValidationReportView
    │   │   ├── designs/         # DesignDetail
    │   │   ├── experiments/     # ExperimentForm (driven by plugin JSON Schemas)
    │   │   ├── jobs/            # JobTable, JobDetail, useJobEvents (SSE)
    │   │   ├── charts/          # FitnessChart, MultiJobOverlay
    │   │   └── viewer/          # OrigamiViewer (r3f), geometry loaders
    │   ├── components/          # ProxyDisclaimer, StatusBadge, ErrorBoundary, ...
    │   └── lib/
    ├── tests/                   # Vitest + RTL + MSW
    └── e2e/                     # Playwright smoke tests
```

---

## 3. API outline (`/api/v1`)

Auth: `Authorization: Bearer <token>` on everything except `/health`. Errors: RFC 9457. Lists use cursor pagination (`?limit=&cursor=`). Mutating launches accept `Idempotency-Key`.

### Health
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness, no deps |
| GET | `/ready` | pings Mongo, Redis, storage |

### Datasets & ingestion
| Method | Path | Notes |
|---|---|---|
| POST | `/datasets` | `multipart/form-data`: `file`, `name`, `format` (`csv`\|`ndjson`\|`json`), optional `description`. Streams to storage with byte limit + SHA-256. Returns **202** `{dataset, ingest_job_id}`. Duplicate SHA-256 → returns existing dataset (configurable). |
| GET | `/datasets` | filter by status, name; paginated |
| GET | `/datasets/{id}` | metadata, ingest status, counts |
| GET | `/datasets/{id}/report` | validation report summary (counts, first N errors per code) |
| GET | `/datasets/{id}/report/download` | full report JSON from storage |
| GET | `/datasets/{id}/designs` | paginated design summaries |
| DELETE | `/datasets/{id}` | soft delete; blocked if referenced by running jobs |

### Designs
| Method | Path | Notes |
|---|---|---|
| GET | `/designs/{id}` | strands summary, metadata, imported measurements (clearly separated) |
| GET | `/designs/{id}/geometry` | `?lod=` downsampled; returns compact binary (`application/octet-stream`, float32 xyz + uint8 strand index) or 404 if no geometry was supplied |

### Plugins (read-only registry)
| Method | Path | Notes |
|---|---|---|
| GET | `/fitness-functions` | name, version, kind, description, limitations, parameter **JSON Schema** |
| GET | `/encodings` | name, version, description, parameter JSON Schema, compatibility requirements |

### Experiments (configuration)
| Method | Path | Notes |
|---|---|---|
| POST | `/experiments` | `{name, dataset_id, design_ids[], encoding{name,version,params}, fitness{name,version,params}, ga{population_size, generations, selection, crossover, mutation, elitism, seed}, limits}` → status `draft`. Params validated against plugin schema. |
| GET | `/experiments` / `/experiments/{id}` | |
| PATCH | `/experiments/{id}` | only while `draft` |
| POST | `/experiments/{id}/launch` | freezes config (stores hash), creates one job per design, enqueues. `Idempotency-Key` required. 429 if admission limits exceeded. |
| POST | `/experiments/{id}/cancel` | cancels all non-terminal jobs |
| GET | `/experiments/{id}/summary` | per-job best fitness, status counts |

### Jobs
| Method | Path | Notes |
|---|---|---|
| GET | `/jobs` | filter `status`, `experiment_id`, `design_id`, `type` |
| GET | `/jobs/{id}` | status, progress `{generation, total}`, attempt, timestamps, error |
| POST | `/jobs/{id}/cancel` | queued → cancelled immediately; running → sets `cancel_requested` |
| POST | `/jobs/{id}/retry` | only from `failed`/`cancelled`; new attempt, resumes from latest checkpoint unless `?from_scratch=true` |
| GET | `/jobs/{id}/generations` | `?from=&to=&fields=` per-generation stats for charts |
| GET | `/jobs/{id}/best` | best genome, decoded design diff, fitness component breakdown |
| GET | `/jobs/{id}/history` | audit trail of state transitions |
| GET | `/jobs/events` | **SSE** stream; `?experiment_id=` or `?job_ids=`; emits status/progress deltas (backed by polling Mongo change timestamps; Change Streams if replica set enabled) |

---

## 4. MongoDB data model

All documents carry `_id` (ObjectId), `created_at`, `updated_at`, `schema_version`.

### 4.1 Collections

**`datasets`**
```jsonc
{
  "name": "Rect-tile batch A", "description": "...",
  "format": "csv", "original_filename": "batchA.csv",
  "storage_key": "raw/<dataset_id>/<sha256>.csv", "size_bytes": 81234567, "sha256": "...",
  "status": "uploaded|ingesting|ready|ready_with_errors|failed",
  "ingest_job_id": ObjectId,
  "counts": { "rows_read": 0, "rows_valid": 0, "rows_invalid": 0, "designs": 0 },
  "report_key": "reports/<dataset_id>/validation.json",
  "deleted_at": null, "owner": "token-id"
}
```
Indexes: `{sha256:1}` (unique, partial on `deleted_at:null`), `{status:1, created_at:-1}`.

**`designs`**
```jsonc
{
  "dataset_id": ObjectId, "external_id": "tile_017", "name": "...",
  "scaffold": { "id": "M13mp18", "length": 7249, "sequence_key": "seq/<design_id>/scaffold.txt" }, // large seq in storage
  "staples": [ { "id": "s001", "sequence": "ACGT...", "helix": 3, "start": 120, "end": 152,
                 "candidates": ["ACGT...", "..."] } ],   // optional user-supplied variants
  "staple_count": 212,
  "geometry": { "present": true, "storage_key": "geometry/<design_id>/lod0.bin",
                "n_points": 14498, "lods": [0,1,2], "kind": "user_supplied|schematic" },
  "metadata": { /* free-form user columns, size-capped */ },
  "measurements": [ { "name": "gel_yield", "value": 0.42, "unit": "fraction",
                      "provenance": { "source": "user_import", "method": "...", "date": "..." } } ]
}
```
Indexes: `{dataset_id:1, external_id:1}` unique, `{dataset_id:1}`.
If a design's staples exceed the 16 MB doc limit headroom (configurable, ~5 MB), staples are moved to storage and referenced.

**`experiments`**
```jsonc
{
  "name": "...", "dataset_id": ObjectId, "design_ids": [ObjectId],
  "encoding": { "name": "candidate_selection", "version": "1.0.0", "params": {} },
  "fitness":  { "name": "sequence_heuristics", "version": "1.0.0", "kind": "computational_proxy", "params": {} },
  "ga": { "population_size": 64, "generations": 200, "selection": {"type":"tournament","k":3},
          "crossover": {"type":"uniform","rate":0.8}, "mutation": {"rate":0.02},
          "elitism": 2, "seed": 12345, "checkpoint_every": 10 },
  "status": "draft|launched|completed|partially_failed|cancelled",
  "config_hash": "sha256 of frozen config", "launched_at": null,
  "idempotency_key": "..."
}
```
Indexes: `{status:1, created_at:-1}`, `{idempotency_key:1}` unique sparse.

**`jobs`** (both ingest and optimize)
```jsonc
{
  "type": "ingest|optimize",
  "experiment_id": ObjectId, "design_id": ObjectId, "dataset_id": ObjectId,
  "status": "queued|running|completed|failed|cancelled",
  "cancel_requested": false,
  "attempt": 1, "max_attempts": 3,
  "celery_task_id": "...", "worker_id": "host:pid",
  "lease_expires_at": ISODate, "heartbeat_at": ISODate,
  "progress": { "generation": 37, "total": 200, "best_fitness": 0.81 },
  "checkpoint": { "generation": 30, "storage_key": "checkpoints/<job_id>/gen-000030.json.gz" },
  "result": { "best_fitness": 0.86, "best_genome_key": "...", "components": {...},
              "fitness_function": { "name": "...", "version": "...", "kind": "computational_proxy" } },
  "error": { "code": "TIMEOUT|PLUGIN_ERROR|INVALID_INPUT|WORKER_LOST|INTERNAL", "message": "...", "retryable": true },
  "queued_at": ..., "started_at": ..., "finished_at": ...
}
```
Indexes: `{experiment_id:1, status:1}`, `{status:1, heartbeat_at:1}` (reaper), `{design_id:1}`, `{experiment_id:1, design_id:1, type:1}` unique (one optimize job per design per experiment).

**`generations`** — one doc per job per generation (small, chart-friendly)
```jsonc
{ "job_id": ObjectId, "attempt": 1, "generation": 37,
  "best": 0.81, "mean": 0.62, "median": 0.63, "worst": 0.31, "std": 0.09,
  "diversity": 0.44, "components_best": { "gc_dev": -0.02, "homopolymer": -0.1 },
  "evaluations": 2368, "elapsed_ms": 412 }
```
Index: `{job_id:1, generation:1}` **unique** → upsert makes re-runs idempotent.

**`job_events`** — append-only history / audit
```jsonc
{ "job_id": ObjectId, "at": ISODate, "from": "queued", "to": "running", "attempt": 1, "actor": "worker:host:pid", "detail": {} }
```
Index: `{job_id:1, at:1}`. Optional TTL index for old events.

**`api_tokens`** — `{ name, token_hash (argon2/sha256+pepper), scopes[], created_at, revoked_at }`.

### 4.2 Data-size rules
- Per-generation **summaries** go in Mongo; full populations only in checkpoints (storage).
- Long sequences and geometry go to storage; Mongo holds keys and counts.

### 4.3 Input-format assumptions (to be confirmed — see §9)

Canonical internal model: **Design = scaffold + staples (+ optional geometry, metadata, measurements).**

**CSV (long format, one row per strand):**
```
design_id,strand_id,strand_type,sequence,helix,start,end,candidate_group
tile_017,scaf,scaffold,ACGT...,,,,
tile_017,s001,staple,ACGTAC...,3,120,152,
tile_017,s001_v2,staple_variant,ACGTTC...,3,120,152,s001
```
Extra columns → `metadata` (string-typed, size-capped). Columns prefixed `meas_` → `measurements` with `provenance.source = "user_import"`.

**NDJSON (one design per line)** mirroring the canonical model, plus optional `geometry: {points: [[x,y,z],...], strand_index: [...]}` — or a separate geometry file referenced by name (preferred for large structures).

**Validation (per row/record):** sequence alphabet `ACGT` (case-insensitive; `N` configurable), length bounds, required columns, duplicate `(design_id, strand_id)`, staple coordinates within scaffold length when given, numeric fields parseable, geometry point count consistency. Errors coded (`E_ALPHABET`, `E_DUPLICATE`, ...) with row number.

**Out of scope for v1:** native caDNAno (`.json`), oxDNA, scadnano, or PDB parsing. These are planned as additional `ingest` adapters behind the same reader interface.

### 4.4 Plugin interfaces (replaceable fitness)

```python
class FitnessFunction(Protocol):
    name: str; version: str
    kind: Literal["computational_proxy", "toy_benchmark", "external"]
    description: str; limitations: str          # required, shown in UI
    params_model: type[BaseModel]               # → JSON Schema for the UI form
    def evaluate_batch(self, design: Design, phenotypes: Sequence[Phenotype],
                       params: BaseModel) -> list[FitnessResult]: ...

class FitnessResult(BaseModel):
    score: float                                # higher is better (documented convention)
    components: dict[str, float]                # explainable breakdown
    valid: bool = True; notes: str | None = None

class Encoding(Protocol):
    name: str; version: str
    def genome_spec(self, design: Design, params) -> GenomeSpec: ...
    def random(self, spec, rng) -> Genome: ...
    def mutate(self, g, spec, rng, rate) -> Genome: ...
    def crossover(self, a, b, spec, rng) -> tuple[Genome, Genome]: ...
    def decode(self, design, g) -> Phenotype: ...
```

Built-ins (v1), all explicitly labelled:
- **Encoding `candidate_selection`** — for each staple slot that has user-supplied candidate variants, choose one. The GA only recombines what the user provided; it does **not** invent sequences.
- **Encoding `real_vector`** — generic bounded numeric vector (for toy benchmarks and future parametric plugins).
- **Fitness `sequence_heuristics`** (`computational_proxy`) — weighted, user-configurable penalties: GC-content deviation from a **user-specified** target, longest homopolymer run over a user threshold, length outside user bounds. Limitations text states these are generic sequence-design heuristics, not folding/stability predictions, and that defaults are placeholders.
- **Fitness `toy_sphere` / `toy_rastrigin`** (`toy_benchmark`) — GA correctness tests only.

Plugins are registered via Python entry points (`origami_evolve.fitness`), so a lab can drop in a scientifically justified evaluator without modifying core code.

---

## 5. Job lifecycle

### 5.1 States and transitions

```
             launch                 worker claims (CAS)
   (none) ───────────▶ QUEUED ─────────────────────────▶ RUNNING
                        │  ▲                               │ │ │
          cancel (API)  │  │ transient failure,            │ │ └── all generations done ──▶ COMPLETED
                        │  │ attempt < max (auto)          │ │
                        ▼  │                               │ └──── cancel_requested seen ──▶ CANCELLED
                   CANCELLED                               │        (between generations)
                        │                                  └────── non-retryable error or
                        │                                          attempts exhausted ─────▶ FAILED
                        └──── manual retry ──▶ QUEUED ◀──────────── manual retry ─────────────┘
```
Terminal: `completed`, `failed`, `cancelled` (the last two allow manual retry, which increments `attempt`).

### 5.2 Atomic transitions
All transitions go through `job_state.transition(job_id, expected_status, expected_attempt, new_status, **fields)` implemented as a single `find_one_and_update` with the expected values in the filter. If it matches nothing, the caller lost a race and backs off. Every successful transition appends a `job_events` record.

### 5.3 Worker execution of an optimize job
1. **Claim:** CAS `queued → running`, set `worker_id`, `started_at`, `lease_expires_at = now + LEASE`. If CAS fails (already running elsewhere/cancelled), ack and exit — this is the duplicate-delivery guard.
2. **Load:** design, frozen experiment config, plugin by `(name, version)` (missing version → `failed: PLUGIN_UNAVAILABLE`, non-retryable).
3. **Resume:** if `checkpoint` exists, restore population + RNG state; else seed RNG from `hash(experiment.seed, design_id)` → reproducible per design.
4. **Loop per generation:** evaluate → upsert `generations` doc → update `progress`, `heartbeat_at`, extend lease → every `checkpoint_every` gens write checkpoint (gzip JSON, atomic rename) then update `checkpoint` pointer → check `cancel_requested`.
5. **Finish:** write best genome to storage, CAS `running → completed` with `result`.

### 5.4 Retry safety
- `generations` unique `(job_id, generation)` + upsert → replays overwrite, never duplicate.
- Checkpoint written before its pointer is updated; a crash between the two just resumes from the previous checkpoint.
- RNG state stored in checkpoint → resumed runs are deterministic.
- Auto-retry only for `retryable` errors (`WORKER_LOST`, transient DB/storage errors) with exponential backoff; plugin exceptions and invalid input are non-retryable.
- `Idempotency-Key` on launch + unique `(experiment_id, design_id, type)` prevents duplicate jobs from double-clicks or client retries.

### 5.5 Cancellation
- Queued: CAS `queued → cancelled` + `celery revoke` (best effort; the claim CAS also blocks it).
- Running: set `cancel_requested=true`; worker stops at next generation boundary, writes final checkpoint, CAS → `cancelled`. Hard fallback: if not honoured within `CANCEL_GRACE_S`, `revoke(terminate=True)` and reaper finalises.

### 5.6 Stale-job reaper (Celery beat, every 60 s)
Finds `running` jobs with `lease_expires_at < now`. If `attempt < max_attempts` → CAS `running → queued`, `attempt+1`, re-enqueue (resumes from checkpoint); else → `failed: WORKER_LOST`. Also marks experiments terminal when all their jobs are terminal.

### 5.7 Ingest jobs
Same state machine. Ingest is idempotent: on retry, delete designs with that `dataset_id` (or upsert by `(dataset_id, external_id)`) before re-parsing. Aborts with `failed: TOO_MANY_ERRORS` if invalid rows exceed `INGEST_MAX_ERRORS` / error ratio.

---

## 6. File-storage strategy

### 6.1 Abstraction
```python
class StorageBackend(Protocol):
    def open_write(self, key) -> ContextManager[BinaryIO]   # writes to temp, atomic commit
    def open_read(self, key) -> ContextManager[BinaryIO]
    def exists(self, key) -> bool
    def delete(self, key) -> None
    def size(self, key) -> int
```
`LocalStorage` (default; a Docker volume mounted at `/data` in api and worker) and, later, `S3Storage` (any S3-compatible service) selected via `STORAGE_BACKEND`.

### 6.2 Key layout (all keys server-generated — never from user filenames)
```
raw/<dataset_id>/<sha256>.<ext>          immutable original upload
reports/<dataset_id>/validation.json     full validation report
seq/<design_id>/scaffold.txt             long sequences
geometry/<design_id>/lod{0,1,2}.bin      float32 xyz + uint8 strand idx, downsampled LODs
checkpoints/<job_id>/gen-<NNNNNN>.json.gz GA state (JSON, never pickle); keep last K
results/<job_id>/best.json               best genome + decoded phenotype
tmp/<uuid>.partial                        in-flight uploads; swept by cleanup task
```

### 6.3 Upload path
1. API reads the request body in chunks (e.g. 1 MiB), writing to `tmp/<uuid>.partial`, updating SHA-256 and a byte counter; aborts with **413** past `MAX_UPLOAD_BYTES` (default 500 MB) and deletes the partial.
2. Checks extension + declared format + a content sniff of the first KB (UTF-8 text; CSV header or JSON/NDJSON start).
3. Atomic rename to `raw/...`, create dataset, enqueue ingest.
Reverse proxy (later) should also enforce body-size limits.

### 6.4 Limits (all env-configurable)
`MAX_UPLOAD_BYTES`, `INGEST_MAX_ROWS`, `INGEST_MAX_ERRORS`, `INGEST_BATCH_SIZE` (insert batch, default 1000), `MAX_SEQUENCE_LENGTH`, `MAX_GEOMETRY_POINTS`, `MAX_METADATA_BYTES`, `CHECKPOINT_KEEP`, `TMP_TTL_HOURS`, `REPORT_MAX_INLINE_ERRORS`.

### 6.5 Retention
Soft-deleted datasets purge files after `RETENTION_DAYS`. Checkpoints beyond the last `CHECKPOINT_KEEP` deleted on completion. Cleanup is a beat task with dry-run logging.

---

## 7. Testing plan

### 7.1 Backend (pytest)
| Layer | What | Tools |
|---|---|---|
| Unit — core | GA operators (selection pressure, crossover preserves gene pool, mutation rate statistics), engine determinism with fixed seed, checkpoint round-trip equals uninterrupted run, encodings, fitness plugins (hand-computed expected values), plugin registry & schema export | pytest, **hypothesis** (property tests) |
| Unit — ingest | CSV/NDJSON/JSON-array readers on valid, malformed, edge-case fixtures (BOM, CRLF, quoted commas, empty lines, unicode, truncated JSON); each error code covered; report aggregation | pytest |
| Memory/scale | Generate 1–2 GB synthetic CSV/NDJSON; assert peak RSS stays under a bound and throughput floor (marked `slow`, not in default run) | tracemalloc/psutil |
| Integration — API | All endpoints, auth failures, 413/415/422/429 paths, pagination, idempotent launch, problem+json shape | httpx AsyncClient, testcontainers (Mongo, Redis) |
| Integration — jobs | State-machine CAS races (two claimers), cancel queued/running, reaper requeue, retry resumes from checkpoint, duplicate task delivery is no-op, non-retryable error → failed | real Celery worker in-process (`celery.contrib.testing.worker`), toy fitness |
| E2E | upload fixture → ingest ready → create experiment over 3 designs → launch → all complete; generations present; SSE emits progress | docker compose `full` |
| Static | ruff (lint+format), mypy `--strict` on `origami_core` | CI |

### 7.2 Frontend
| Layer | What | Tools |
|---|---|---|
| Unit/component | upload validation & progress, report table, experiment form generated from JSON Schema, job status badges, chart data transforms, `ProxyDisclaimer` presence on every fitness view | Vitest, React Testing Library, MSW |
| Viewer | geometry parser/LOD selection unit-tested; component smoke-renders with WebGL mocked | Vitest |
| E2E smoke | full happy path against compose stack | Playwright |
| Static | `tsc --noEmit` strict, ESLint, OpenAPI type generation diff check | CI |

### 7.3 CI (GitHub Actions, optional)
Lint + unit on every push; integration with service containers; e2e nightly or on label.

Coverage target: ≥ 90 % for `origami_core`, ≥ 80 % overall backend; meaningful tests over raw percentage.

---

## 8. Implementation milestones

Each milestone ends with passing tests, updated docs, and a demo-able state.

| # | Milestone | Deliverables | Acceptance |
|---|---|---|---|
| **M0** | Scaffolding | Repo layout, `docker-compose.yml` (mongo, redis; `full` profile), `.env.example`, pydantic-settings config, FastAPI app with `/health` `/ready`, Celery app with a ping task, Vite+React+TS+Tailwind shell, lint/format/type/test tooling, README quickstart (PowerShell + bash) | `docker compose --profile full up` → `/ready` green; `npm run dev` shows shell; `pytest` & `vitest` pass |
| **M1** | Storage + ingestion | `StorageBackend` + local impl, streaming upload with limits & SHA-256, CSV/NDJSON/JSON readers, validators, validation report, ingest task, datasets/designs endpoints, token auth, frontend upload + dataset list + report view | Upload a 500 MB synthetic file with bounded memory; invalid rows reported with codes; duplicate upload detected |
| **M2** | GA engine + plugin interfaces | `origami_core.ga`, encodings (`candidate_selection`, `real_vector`), fitness registry, `sequence_heuristics` proxy, toy benchmarks, checkpoint/restore, `/fitness-functions` `/encodings` | GA reaches known optimum on toy benchmarks; resume-from-checkpoint == uninterrupted run (same seed); limitations text exposed via API |
| **M3** | Job orchestration | Experiments CRUD + launch, optimize task, CAS state machine, progress/heartbeat, cancel, manual/auto retry, reaper, admission limits, `job_events`, SSE | Launch 10 designs with concurrency 2 → exactly 2 running at a time; kill a worker mid-run → job resumes; cancel works in both states |
| **M4** | Frontend workflows + charts | Experiment builder (schema-driven forms), job dashboard with live SSE, job detail, fitness chart (best/mean/worst bands), multi-job overlay, proxy disclaimers | Full flow usable without curl; charts update live |
| **M5** | 3D viewer | r3f viewer with instanced nucleotides/helix schematic, LOD loading, strand colouring, best-candidate highlighting, "user-supplied vs schematic" label | 100k points interactive (≥ 30 fps on mid-range laptop); graceful "no geometry supplied" state |
| **M6** | Hardening + docs | Rate limiting, security headers, CORS allowlist, non-root images, dependency audit (pip-audit, npm audit), structured JSON logging + request IDs, Playwright e2e, scale tests, docs (`input-formats.md`, `fitness-plugins.md`, `job-lifecycle.md`) | All test suites green; security checklist complete; a new developer can set up from README alone |

### Security basics (applied from M0 onward, completed in M6)
Bearer API tokens (hashed at rest), CORS allowlist, request size limits, strict Pydantic models (`extra="forbid"`), no user-controlled Mongo operators (repositories build queries from typed fields only), Celery JSON-only serialization, server-generated storage keys (no path traversal), content sniffing on upload, secrets only via env (`.env` git-ignored), non-root containers, Mongo/Redis bound to localhost in compose with auth enabled, rate limiting on upload/launch, dependency scanning.

---

## 9. Assumptions & open questions (please confirm or correct)

1. **Input format.** I assumed the CSV long format and NDJSON shapes in §4.3. Do you have real example files, or do you need caDNAno/scadnano/oxDNA import in v1?
2. **What the GA mutates.** I assumed it selects among **user-supplied staple candidate variants** (it never invents sequences). Is there a different decision variable you have in mind (e.g. staple break points, crossover positions, parametric geometry)?
3. **Fitness.** v1 ships only labelled sequence-level heuristics and toy benchmarks. Do you have a specific scientifically justified metric or external tool to wrap? Until then the defaults are placeholders.
4. **Single- vs multi-objective.** v1 = weighted scalar with an explainable component breakdown. Do you need Pareto (NSGA-II) optimization?
5. **Geometry.** Viewer renders user-supplied coordinates, or a labelled schematic from helix/position columns. No structure prediction. Acceptable?
6. **Auth/tenancy.** v1 = single-tenant with static API tokens. Do you need multi-user accounts / roles?
7. **Scale targets.** Assumed: files up to 500 MB, ≤ ~10k designs per dataset, ≤ 50 concurrent queued jobs, populations ≤ 500, generations ≤ 5,000. Adjust?
8. **Storage.** Local volume by default with an S3-compatible adapter later. Is a cloud object store required now?

---

## 10. Implementation notes and deviations (kept current)

**M0**
- Compose: MongoDB and Redis have no profile (a plain `docker compose up` starts them); app services use `full`.
- `httpx2` replaces `httpx` for Starlette's TestClient, following Starlette's deprecation notice.

**M1**
- **Uploads are raw request bodies, not multipart** (§3, §6.3). Starlette parses multipart fully, to an unbounded
  temp file, before the handler runs, so the byte limit couldn't be enforced while streaming. Metadata moves to
  query parameters.
- **Duplicates are always deduplicated** by SHA-256 (returns `200` with the existing dataset). The unique key is
  removed on soft delete, so the same file can be uploaded again later.
- **Added `POST /datasets/{id}/ingest`** to re-run validation. A broker outage at upload time marks the job `failed`
  (`DISPATCH_FAILED`, retryable) instead of leaving it queued forever.
- **CSV rows of a design must be contiguous** (keeps memory bounded to one design). Measured: 120 MB CSV and
  105 MB NDJSON peak at about 1.5 MB of traced memory. Untraced throughput is about 7.5 MB/s, so 500 MB takes about
  a minute.
- **A design with any error is rejected whole**; a fatal error stores no designs at all. Strand-level issues report
  the offending row's line number.
- `geometry` in JSON records is rejected until M5.
- Scaffold sequences stay in the design document (bounded by `ORIGAMI_INGEST_MAX_DESIGN_BYTES`) rather than in file
  storage, which simplifies M2.
- Tests run against **mongomock** behind a small async adapter, so they need no Docker. The same flow runs against a
  real MongoDB with `pytest -m services`.
- Known gap until M3: if a worker dies mid-ingest the job stays `running`. The M3 stale-job reaper requeues it.
  Ingestion is idempotent, so the rerun is safe.
- `openapi-typescript` runs through `npx` because it requires a TypeScript 5 peer and the project uses TypeScript 6.

**M2**
- **PyGAD 3.8** replaces the planned in-house engine, as you specified. Fixed parameters: population 50,
  generations 100, mutation 0.05, crossover 0.8, elitism 2, tournament size 3, seed 42 (configurable), maximize.
- `num_parents_mating` is required by PyGAD and isn't in the specification. It is set to the population size,
  so every tournament-selected parent mates. It is reported in the result's `parameters`.
- The chromosome has one integer gene per staple with supplied variants (`0` = original sequence, `k` =
  `candidates[k-1]`). Designs without variants are rejected, because nothing is ever generated.
- The fitness interface is `check_design` plus `evaluate(design, staples) -> FitnessResult`. The only
  implementation is `synthetic_gc_balance_demo`, labelled `computational_proxy`, which refuses designs not marked
  `metadata.source == "synthetic"`.
- Checkpointing (§5.3), persistence, API endpoints and queueing are deferred to M3, as instructed.

**M3**
- "Experiments" (§3) are implemented as **batches**: `POST /batches {dataset_id, design_ids?, seed?, name?}`
  with an optional `Idempotency-Key`. Other endpoints: `GET /batches`, `GET /batches/{id}`,
  `GET /batches/{id}/jobs`, `POST /batches/{id}/cancel`, `GET /jobs/{id}`, `POST /jobs/{id}/cancel`,
  `POST /jobs/{id}/retry` and `GET /jobs/{id}/result`.
- Concurrency is the optimize worker's process count: `ORIGAMI_OPTIMIZE_CONCURRENCY`, default 2. With
  `prefetch=1` and late acks, each process runs one job at a time.
- Duplicate execution is prevented with attempt fencing. Task messages carry `(job_id, attempt)`, claims and all
  worker writes are filtered on that attempt, so retries and requeues bump it and older messages become no-ops.
- Stale jobs are recovered by a beat task that runs every 60 s. A job with no heartbeat for
  `ORIGAMI_JOB_STALE_AFTER_S` is requeued as a new attempt, up to `ORIGAMI_JOB_MAX_STALE_REQUEUES` times, and is
  then failed with `WORKER_LOST`. Ingest jobs are failed rather than requeued, which closes the M1 gap.
- No mid-run GA checkpoints: a requeued job restarts from generation 0. With a fixed seed it gives the same result.
- Fitness histories are stored in `results/<job_id>/attempt-<n>.json`; job documents only hold a summary and the
  file key.
- The frontend's generated API types were not regenerated (no frontend changes in M3). Run `npm run gen:api` when
  a UI for batches is added.

**M4**
- The **Batch Optimization** page (`/batches`, `/batches/:id`) uses the M3 endpoints unchanged; the API types were
  regenerated from the backend.
- Live updates use polling, not SSE (§3): the batch and its jobs are polled every 2 s while anything is queued or
  running. React Query doesn't overlap requests and stops polling when the page unmounts. SSE remains a possible
  later improvement.
- The fitness chart is a small inline SVG rather than Recharts (§1.3), to avoid a new dependency.
- Each submission sends an `Idempotency-Key`, reused if the same submission is retried, so a double submit or a
  network retry can't create duplicate batches.

**3D viewer** (plan M5; requested as "M6")
- `/viewer` uses three.js and @react-three/fiber, loaded lazily so the main bundle doesn't include three.js.
  OrbitControls handle rotate, zoom and pan, and there are Zoom and Reset buttons. Rendering is on demand, and
  remounting per design releases the GPU resources.
- **The data contains no molecular coordinates.** The ingestion schema still rejects `geometry`, and nothing stores
  scaffold routing, crossovers or a helix lattice. So the only geometry drawn is an **index-space schematic**: one
  lane per helix index and one bar per staple spanning `start..end`, labelled in the UI as not a molecular
  structure. Scaffold and crossovers aren't drawn, and the UI lists them as missing. The conversion is documented
  in `frontend/src/features/viewer/geometry.ts`.
- Showing real molecular coordinates needs backend work first: accept `geometry` in ingestion, store it outside the
  design document, and add a geometry endpoint (§3, §4.1). Then a `kind: "molecular"` representation can be added
  next to the schematic.

**M5 (integration and deployment readiness)**
- **Security fixes:**
  - Unhandled exceptions now return generic problem+json 500s instead of Starlette's plain-text page.
  - Non-upload request bodies are capped at `ORIGAMI_MAX_JSON_BODY_BYTES` (1 MiB); a body without a length gets 411.
    `design_ids` holds at most 10,000 entries.
  - Every API response sends `Cache-Control: no-store` and `Content-Security-Policy: default-src 'none';
    frame-ancestors 'none'`. The Swagger UI page is exempt from the CSP.
- **Worker healthchecks** in Compose: each worker pings its own Celery node through Redis.
- **End-to-end test** (`tests/integration/test_real_mongo.py`, marker `services`) extended to upload, ingest,
  duplicate check, batch, optimize and result retrieval against a real MongoDB.
- **Benchmark** in `backend/scripts/benchmark_optimizer.py`; measured numbers are in the README.
- **Not changed:** the GA, the fitness function, the GA defaults and the data model.

**M7 (real structure support)**
- **oxDNA** (classic and `5->3` topologies, plus configuration) is the source of molecular coordinates. They are
  parsed and validated in `origami_core.structure`, and used **as stored**: only translated to the centroid for
  display.
- **caDNAno 2** JSON is validated and summarised as **topology only**. OrigamiEvolve does not implement any
  caDNAno→coordinates geometry itself.
- **tacoxDNA** is an optional external converter (`ORIGAMI_TACOXDNA_DIR`). It requires a lattice stated by the user
  and the linked design's scaffold sequence, so the converter never assigns sequences on its own. Its output passes
  the same oxDNA validation. Not bundled, and tested only with a stand-in script.
- **Storage and API:** a `structures` collection (status, summary, issues, mapping, conversion provenance). Files go
  to `structures/<id>/` in the storage volume. Endpoints are under `/api/v1/structures` (raw-body uploads, exempt from
  the JSON body limit but capped by `ORIGAMI_MAX_STRUCTURE_BYTES`). Validation and conversion run on the ingest
  worker.
- **Mapping:** design strand ↔ structure strand only by identical, unique sequence. Job variants are annotations on
  mapped staples, with a length check; structures are never remodelled.
- **Viewer:** a separate molecular mode (instanced nucleotides plus backbone lines, lazy-loaded) when coordinates
  exist. The schematic stays as the fallback, with a status banner explaining why molecular mode is unavailable.
- **Not verified:** a real oxDNA or caDNAno file, a real tacoxDNA run, and very large structures in the browser.
  There is no upload UI (API only). Circular scaffolds stored with a rotated start position don't match.

**M8 (objective evaluation)**
- The objective interface (`FitnessFunction`, a registry and `describe()`) is separate from implementations. Adding
  an objective means registering it; the GA, API and worker are unchanged. Batches take an optional `fitness` name
  (default `synthetic_gc_balance_demo`), and `GET /fitness-functions` lists objectives with their limitations.
- **New metric:** `staple_scaffold_complementarity` (Watson–Crick match fraction against the declared scaffold
  segment). It refuses designs without a scaffold or a consistent `start`/`end`, rather than guessing.
- **Not implemented (blockers documented in the README):** nearest-neighbour thermodynamics (needs a vetted
  external library), folding yield (needs experimental data), structural strain (needs coordinates and simulation).
- GA results now report `evaluations` (fitness requests) and `unique_evaluations` (distinct genomes scored).
  Baselines live in `origami_core.ga.baselines`: random search with a matched budget, and exhaustive enumeration.
- `backend/scripts/evaluate_optimizers.py` writes `docs/benchmarks/optimizer_evaluation.{csv,json}`. GA defaults
  are unchanged.

**Structure origin and oxDNA simulation (follow-up to M7)**
- Cause of the "straight lines": the only structures with coordinates were the synthetic placeholders from the M7
  endpoint check (straight strands, z = 0). They are now flagged with `W_NONHELICAL_GEOMETRY`, and the viewer marks
  them "Not a molecular structure".
- Every structure has an `origin` (imported / generated / simulated). "Predicted" is never used.
- `POST /structures/{id}/simulate` uses an optional oxDNA executable (`ORIGAMI_OXDNA_BIN`) and stores the output as a
  child structure with provenance. It is tested only with a stand-in executable; oxDNA is not installed and no real
  structure file has been processed.

**Batch usability (branch fix/batch-usability)**
- **Objective compatibility at creation.** `POST /batches` loads every resolved design and calls the objective's own
  `check_design()` before anything is stored. Incompatible designs give 422 listing up to 20 external ids with the
  reason, and no batch, job or queue message is created. Before, the worker failed every job with `FitnessError`.
  `GET /datasets/{id}/compatibility?fitness=` reports `{design_id, external_id, compatible, reason}` per design,
  paged like `/designs`. The batch form disables incompatible designs with the reason and shows a notice when the
  default demo objective cannot be used. The worker still checks (a design could change after creation).
- **Search method.** `method: auto | ga | exhaustive` (default `auto`). The worker resolves `auto`: exhaustive
  enumeration when a design has at most `ORIGAMI_EXHAUSTIVE_AUTO_MAX` (4096) combinations, otherwise the GA.
  `exhaustive_optimize` (in `origami_core.ga.optimizer`) returns the existing `OptimizationResult` shape with
  `method`, a `note`, an empty `fitness_history`, `final_population_fitness: null` and the top 10 of all
  combinations; ties resolve like the GA (lexicographically smallest genome). The method used is stored in the
  result and job summary. Results stored earlier have no `method` and read as `ga`. Explicit `exhaustive` above
  `ORIGAMI_EXHAUSTIVE_MAX_COMBINATIONS` is refused with 422. Exhaustive runs report no per-generation progress or
  cancellation (they are small by construction).
- **Behaviour change:** with the default `auto`, the 8-combination example designs are now enumerated instead of
  run through the GA. Tests that exercise generations, progress or cancellation request `method: "ga"`.
- **Configurable GA settings.** `population_size`, `generations`, `mutation_rate`, `crossover_rate`, `elitism`,
  `tournament_size` are optional in `POST /batches`; omitted fields keep the defaults (unchanged: 50 / 100 / 0.05 /
  0.8 / 2 / 3, seed 42). `GAParameters` validates them (422), with server limits `ORIGAMI_GA_MAX_POPULATION` (500)
  and `ORIGAMI_GA_MAX_GENERATIONS` (1000). The values used are stored in batch and job `params` and shown on the
  batch page. `JobOut` now also exposes `method`, `fitness` and `params`.
- **Demo objective display.** Shown as "mean GC deviation = X (lower is better)" (from `best_components`, or the
  negated score, which is the definition) with the stored score in smaller text. Fitness formulas and stored values
  are unchanged.
- **Structures page** (`/structures`): oxDNA (topology then configuration) and caDNAno uploads as raw bodies, a
  status list with origin, issue codes and viewer links, and Convert only when `GET /structures/tools` reports
  tacoxDNA. This closes the "no upload UI" gap noted for M7.
- **Select all designs in dataset** omits `design_ids` so the server uses every design (all pages).
- **Bundle:** three.js and @react-three/* are split into their own chunks behind the viewer's lazy import (rolldown
  `codeSplitting` groups with `includeDependenciesRecursively: false`, so react stays in the entry chunk). three.js
  alone is ~756 kB minified (mostly the single `three.core.js` module), so it cannot be split under 500 kB.
  `chunkSizeWarningLimit` is 800 kB, and the entry chunk is ~400 kB.

**3D viewer: idealized helix model (branch viewer/3d-helix)**
- New default viewer mode for designs without usable imported coordinates: an **idealized B-DNA model** generated from
  staple `helix`/`start`/`end` and the scaffold sequence (0.34 nm rise, 10.5 bp/turn, 1.0 nm backbone radius, 144°
  minor-groove offset, 2.25 nm helix spacing). Molecular mode stays the default when a valid oxDNA structure exists;
  the schematic is unchanged and one click away.
- The lattice (honeycomb / square / single row) is a user choice, with a documented, deterministic index → position
  mapping. It is labelled as a display assumption, as are the missing crossovers and scaffold routing; nothing is
  inferred. The banner states it is not a molecular structure.
- Rendering: CatmullRom tubes per scaffold/staple, one InstancedMesh for all base-pair rungs and one for end caps,
  MeshStandardMaterial, hemisphere + two directional lights, damped orbit controls (render-on-demand, keeps rendering
  only while damping or auto-rotate run), explicit disposal on unmount. The scene is lazy-loaded like the others.
- Frontend only; no backend or API changes. Existing viewer tests that relied on the schematic being the default now
  switch to it explicitly (assertions unchanged).
