# OrigamiEvolve

Research prototype for managing DNA origami datasets and running genetic-algorithm (GA) optimization of many designs concurrently.

> **Scientific scope.** OrigamiEvolve orchestrates data and optimization. It is **not** a folding simulator or stability model.
> Every fitness score is produced by a replaceable, versioned plugin and labelled as a **computational proxy**. The only
> fitness function shipped today, `synthetic_gc_balance_demo`, is a demonstration for synthetic data. No score is evidence
> that a design folds, is stable, or has a given yield. Experimental measurements are only ever *imported by the user*,
> stored with provenance, and kept separate from computed scores. The 3D viewer draws either an **index-space schematic**
> (not a molecular structure) or, when you import an oxDNA file, **the coordinates stored in that file**, which
> OrigamiEvolve neither generates nor validates physically. See [docs/PLAN.md](docs/PLAN.md) §0.

## Contents

- [Status](#status) · [Architecture](#architecture) · [Prerequisites](#prerequisites)
- [Quickstart (Windows PowerShell)](#quickstart-windows-powershell) · [API tokens](#api-tokens) · [Using the app](#using-the-app)
- [Structures (oxDNA / caDNAno)](#structures-oxdna--cadnano) · [API usage](#api-usage) · [Configuration](#configuration-environment-variables) · [Tests and checks](#tests-and-checks)
- [Benchmark](#benchmark) · [Troubleshooting](#troubleshooting) · [Limitations](#current-limitations) · [Security](#security)

## Status

| Milestone | State |
|---|---|
| M0: Scaffolding | ✅ done |
| M1: File storage and data import | ✅ streaming upload, CSV/NDJSON/JSON readers, validation reports, token auth, dataset UI |
| M2: GA engine | ✅ PyGAD optimizer over user-supplied staple variants, replaceable fitness interface, labelled demo fitness |
| M3: Batch optimization | ✅ one Celery job per design, bounded concurrency, cancel/retry, stale-job recovery, results in file storage |
| M4: Batch UI and monitoring | ✅ Batch Optimization page: create, list, live job status, cancel/retry, results with fitness chart |
| 3D viewer | ✅ `/viewer`: idealized B-DNA helix model and index-space schematic from staple helix/start/end; molecular mode for imported oxDNA coordinates |
| M5: Integration and deployment readiness | ✅ end-to-end test, security fixes, benchmark, worker healthchecks, this README |
| M8: Objective evaluation | ✅ pluggable objectives, staple–scaffold complementarity metric, GA vs random vs exhaustive evaluation |
| M7: Real structure support | ✅ oxDNA import with coordinates, caDNAno topology validation, optional tacoxDNA conversion, molecular viewer mode |
| Batch usability | ✅ objective compatibility checked at batch creation, exhaustive search for small spaces, configurable GA settings, Structures page |

Plan, data model, job lifecycle and every deviation: [docs/PLAN.md](docs/PLAN.md) (§10 lists changes per milestone).

## Architecture

```
 Browser (React + Vite, :5173) ──/api──▶ api (FastAPI, :8000) ──▶ MongoDB (metadata, jobs, history)
                                             │  enqueue (JSON only)      ▲
                                             ▼                           │
                                           Redis (broker) ──▶ worker-ingest   (queues: ingest, maintenance)
                                                          ──▶ worker-optimize (queue: optimize, concurrency 2)
                                           beat ── every 60 s ──▶ stale-job reaper
                     api + workers ──▶ storage volume /data (raw uploads, validation reports, GA results)
```

- **backend/src/origami_core**: pure domain library (models, streaming ingest, GA, fitness plugins, storage). It imports
  no FastAPI, MongoDB, Celery or Redis; a test enforces this.
- **backend/src/origami_api**: FastAPI app. It authenticates, validates, stores uploads and enqueues work. CPU-heavy work
  never runs in request handlers.
- **backend/src/origami_worker**: Celery tasks for ingestion, optimization (one job per design) and the reaper. Every
  job state change is an atomic compare-and-set; messages carry the attempt number, so duplicate or outdated messages
  do nothing.
- **frontend**: React 19, TypeScript, Tailwind v4, TanStack Query, three.js / react-three-fiber (viewer, lazy-loaded).

## Prerequisites

- **Docker Desktop**, running. On Windows the Celery workers only run in Docker.
- **Python 3.12+** (for backend tests and tools on the host) and **Node.js 22+** (frontend).

## Quickstart (Windows PowerShell)

Run these from the project folder. Windows PowerShell 5.1 doesn't support `&&`; use separate lines or `;`.

```powershell
cd "$HOME\Desktop\ORIGAMIEVOLVE"

# 1. Configuration (only if .env doesn't exist yet; never overwrite an existing .env)
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env      # replace every "change-me" value; see "Configuration" below

# 2. Start everything: MongoDB, Redis, API, workers, scheduler
docker compose --profile full up -d --build
docker compose --profile full ps                      # api, mongo, redis and both workers should be "healthy"
Invoke-RestMethod http://127.0.0.1:8000/api/v1/ready  # status ok, checks mongo/redis/storage ok

# 3. Create an API token (printed once; keep it somewhere safe)
docker compose exec -T api python -m origami_api.cli create-token me

# 4. Frontend (second terminal)
cd frontend
npm install
npm run dev       # open http://localhost:5173 and paste the token into "API token"
```

Stop the stack without losing data: `docker compose --profile full stop` (or `down`, **without** `-v`).
Data lives in the named volumes `origami-evolve_mongo-data`, `origami-evolve_redis-data` and `origami-evolve_storage-data`.

### Backend tools on the host (tests, benchmark, codegen)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
```

## API tokens

Every endpoint except `/health` and `/ready` needs `Authorization: Bearer <token>`. Only a SHA-256 hash is stored.

```powershell
docker compose exec -T api python -m origami_api.cli create-token <name>   # prints the token once
docker compose exec api python -m origami_api.cli list-tokens           # names and dates only, never values
docker compose exec api python -m origami_api.cli revoke-token <name>   # takes effect on the next request
```

Use `-T` when creating tokens: without it Docker allocates a TTY that merges the CLI's advisory line into the output,
so `$t = docker compose exec api ... create-token x` would capture two lines and every request fails with 401.
To keep the token out of the console and history: `$t = docker compose exec -T api python -m origami_api.cli create-token x`.

The frontend keeps the token in `sessionStorage` (cleared when the tab closes). Never paste tokens into issues or docs.

## Using the app

| Page | What it does |
|---|---|
| **Datasets** | Upload CSV / NDJSON / JSON ([formats](docs/input-formats.md)); see the validation report and stored designs. Try [`examples/synthetic_designs.csv`](examples/synthetic_designs.csv). |
| **Batch Optimization** | Pick a validated dataset, select designs, objective, search method and seed (default 42); optionally change the GA settings under *Advanced GA settings*; start a batch. Designs the chosen objective cannot score are disabled with the reason (the server also refuses such batches with 422). With more designs than are loaded, *Select all designs in dataset* sends the batch without `design_ids`. Then watch jobs live; cancel, retry. **Analysis** per job: summary cards, interactive best/mean-per-generation chart (recorded GA values; live while running, kept for failed/cancelled jobs), final-population ranking with details and copyable sequences, final fitness distribution. Results from before this feature have no ranking, and the UI says so. |
| **Structures** | Import oxDNA (topology, then configuration) or caDNAno JSON, optionally linked to a design (raw-body uploads, no multipart). The list shows status (ready / topology only / invalid), origin, issue codes and a link to the 3D viewer; *Convert to oxDNA* (square / honeycomb lattice) appears only when tacoxDNA is available. |
| **3D Viewer** | Pick a design, a completed job or an imported structure. Three modes: **Molecular** (default when a valid oxDNA structure exists: stored coordinates, strands coloured by verified identity), **Idealized helix model** (default otherwise; see below) and the index-space **Schematic**. The missing structural data is always listed. |
| **System status** | MongoDB, Redis and storage readiness. |

**Search method** (per batch, `"method"` in `POST /batches`):
- `auto` (default): if a design has at most `ORIGAMI_EXHAUSTIVE_AUTO_MAX` (4096) combinations of supplied variants,
  every combination is scored (exact optimum under the objective); otherwise the GA runs.
- `ga`: always the GA. `exhaustive`: always enumerate; refused (422) above `ORIGAMI_EXHAUSTIVE_MAX_COMBINATIONS`.

Exhaustive results have the same shape as GA results (best genome, components, selected variants, top 10 candidates)
with `method: "exhaustive"`, an empty `fitness_history` and a note that no generations were run; the analysis page
shows "Exhaustive search" and no chart. On the example designs both methods find the same best fitness.

**GA settings** default to population 50, 100 generations, mutation 0.05, crossover 0.8, elitism 2, tournament size 3,
maximize, seed 42. A batch may override `population_size`, `generations`, `mutation_rate`, `crossover_rate`,
`elitism` and `tournament_size`; values are checked by `GAParameters` (422 if invalid, e.g. elitism >= population)
and limited by `ORIGAMI_GA_MAX_POPULATION` (500) and `ORIGAMI_GA_MAX_GENERATIONS` (1000). The settings used are
stored on the batch and every job and shown on the batch page.

**Demo objective display:** `synthetic_gc_balance_demo` stores score = -(mean GC deviation). The UI shows it as
"mean GC deviation = X (lower is better)" with the stored score in smaller text; stored values are unchanged.

## 3D viewer: idealized helix model

For designs without imported coordinates, the viewer draws an **idealized B-DNA model** built only from each staple's
`helix`, `start` and `end` and the scaffold sequence (`frontend/src/features/viewer/idealHelix.ts`, constants documented
at the top):

- Textbook B-DNA: 0.34 nm rise per base pair, 10.5 bp per turn (34.29° twist), 1.0 nm backbone radius, staple strand
  offset 144° from the scaffold strand (minor groove).
- Helix centres 2.25 nm apart on a lattice **you choose** (honeycomb, square or single row). Helix indices are sorted and
  placed in row-major order; this is a display choice, not the design's real arrangement.
- Per helix: the scaffold as one backbone tube over the range its staples cover; each staple as its own tube on the
  complementary strand; one base-pair rung per staple position, coloured by the scaffold base (A red, T green, G yellow,
  C blue) or by strand. Staples: teal = original kept, amber = GA chose a supplied variant, grey = no variants; scaffold
  blue.
- **Not drawn, because the data does not contain them:** crossovers, scaffold routing between helices, loops/skips,
  sequence-dependent geometry. The banner says so: it is not a molecular structure.
- Toolbar: zoom, reset, auto-rotate (disabled when the OS asks for reduced motion), lattice, colour mode, legend,
  **Download PNG**. Hover or click a staple to see its id, helix, start–end, length and the GA's decision.

Screenshots: [`docs/screenshots/viewer-3d-helix/`](docs/screenshots/viewer-3d-helix/).

## Structures (oxDNA / caDNAno)

Import real structure files on the **Structures** page or through the API; view them in **3D Viewer → Imported
structure**, or automatically when you open a design the structure is linked to. Formats and validation codes:
[docs/input-formats.md](docs/input-formats.md#structure-files).

| Format | What OrigamiEvolve does | Coordinates? |
|---|---|---|
| **oxDNA** topology (`.top`, classic or `5->3`) + configuration (`.dat`/`.oxdna`) | Validates counts, bases, strand connectivity, finite numbers and unit orientation vectors; stores the files; serves the coordinates **as stored** | Yes, from the file |
| **caDNAno 2** JSON | Validates helix/strand links and summarises helices, strands and crossovers | No (topology only) |
| caDNAno → oxDNA via **tacoxDNA** (optional) | Runs `cadnano_oxDNA.py` with the lattice you state and the **scaffold sequence of the linked design**, then validates the output like an oxDNA upload | Yes, from tacoxDNA |

```powershell
$t = Read-Host "API token"; $h = @{ Authorization = "Bearer $t" }; $api = "http://127.0.0.1:8000/api/v1"

# oxDNA: upload the topology, then the configuration (optionally link a design: &design_id=<id>)
$st = Invoke-RestMethod -Method Post -Headers $h -ContentType "application/octet-stream" `
  -InFile my_origami.top -Uri "$api/structures?name=my_origami&format=oxdna"
Invoke-RestMethod -Method Put -Headers $h -ContentType "application/octet-stream" `
  -InFile my_origami.dat -Uri "$api/structures/$($st.id)/configuration"
Invoke-RestMethod -Headers $h "$api/structures/$($st.id)"          # status: ready | invalid (see issues)

# caDNAno: validated as topology only
$cd = Invoke-RestMethod -Method Post -Headers $h -ContentType "application/octet-stream" `
  -InFile design.json -Uri "$api/structures?name=my_cadnano&format=cadnano&design_id=<design id>"
# Optional conversion (needs tacoxDNA, below): you state the lattice
Invoke-RestMethod -Method Post -Headers $h "$api/structures/$($cd.id)/convert?lattice=honeycomb"
```

**Strand identities.** When a structure is linked to a design (`design_id`), a design strand is mapped to a structure
strand only if their sequences are identical and the match is unique; the result (`verified` / `partial` /
`unmatched`) is shown in the viewer. Optimized variants are shown as annotations on mapped staples, with a length
check. The structure still contains the original sequences; nothing is remodelled.

**Origin labels.** Every structure is labelled by where its coordinates came from:
- **imported**: as stored in uploaded oxDNA files.
- **generated**: produced by tacoxDNA from caDNAno; an initial geometry, not relaxed.
- **simulated**: the final configuration of an oxDNA run started from another structure.

Nothing is labelled a "prediction". If every strand in a file is a perfectly straight line, which double-helical DNA
never is, validation adds `W_NONHELICAL_GEOMETRY` and the viewer shows a red "Not a molecular structure" warning. The
`m7-check … synthetic` structures in the database are such placeholders, created only to test the endpoints.

**oxDNA relaxation and simulation (optional, unverified in this project).**
`POST /api/v1/structures/{id}/simulate?protocol=relax|md&steps=N` runs oxDNA (DNA2 model, 20 °C, 0.5 M salt) on a
`ready` oxDNA structure and stores the final configuration as a **new** structure (`origin: simulated`, `parent_id`,
protocol, steps and last energy line recorded). The source structure is never changed.
- `relax`: Monte Carlo with capped backbone forces, to remove clashes and stretched bonds.
- `md`: molecular dynamics; run it after `relax`.

The input-file keys follow oxDNA's documented examples but have not been run against a real oxDNA build here.

Missing dependency: **the oxDNA executable**. It isn't installed in the containers, and without it `/simulate`
returns 503. Simplest setup:
1. Build oxDNA for Linux, matching the container architecture (here `aarch64`), from
   https://github.com/lorenzo-rovigatti/oxDNA: `cmake ..` then `make` gives `build/bin/oxDNA`. A Windows build won't
   run in the containers.
2. Put it in `tools/oxdna/` as `oxDNA`. Compose already mounts that folder read-only at `/opt/oxdna` in the app
   containers; see `tools/oxdna/README.md`.
3. Set `ORIGAMI_OXDNA_BIN=/opt/oxdna/oxDNA` in `.env`, then run `docker compose --profile full up -d`.

To go from a caDNAno design to a simulated structure:
1. Import the caDNAno file with `design_id`.
2. Run `/convert` (needs tacoxDNA).
3. Run `/simulate?protocol=relax`.
4. Optionally run `/simulate?protocol=md`.

**Optional tacoxDNA setup (unverified in this project).** tacoxDNA is not bundled. To enable conversion, obtain
tacoxDNA yourself, make its `src` folder visible inside the `api`, `worker-ingest` containers (for example a bind
mount added to `docker-compose.yml`), and set `ORIGAMI_TACOXDNA_DIR` to that in-container path. Without it,
`/convert` returns 503. The adapter has only been tested with a stand-in script; the exact tacoxDNA command-line
arguments (`sq` / `he` and the sequence file) should be checked against your tacoxDNA version.

## API usage

Interactive docs: <http://127.0.0.1:8000/api/v1/docs>. PowerShell examples (`$t` holds your token):

```powershell
$t = Read-Host "API token"                       # paste; not echoed to history files
$h = @{ Authorization = "Bearer $t" }
$api = "http://127.0.0.1:8000/api/v1"

# Upload (raw file body, streamed) and check validation
$ds = Invoke-RestMethod -Method Post -Headers $h -ContentType "application/octet-stream" `
  -InFile examples\synthetic_designs.csv -Uri "$api/datasets?name=example&format=csv"
Invoke-RestMethod -Headers $h "$api/datasets/$($ds.dataset.id)"

# Batch over all designs (seed 42); the Idempotency-Key makes resubmits safe
$b = Invoke-RestMethod -Method Post -Headers ($h + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }) `
  -ContentType "application/json" -Body (@{ dataset_id = $ds.dataset.id; seed = 42; method = "auto" } | ConvertTo-Json) -Uri "$api/batches"
Invoke-RestMethod -Headers $h "$api/batches/$($b.id)"
$jobs = (Invoke-RestMethod -Headers $h "$api/batches/$($b.id)/jobs").items
Invoke-RestMethod -Headers $h "$api/jobs/$($jobs[0].id)/result"
```

| Method | Path | |
|---|---|---|
| GET | `/health`, `/ready` | liveness / readiness (no auth) |
| POST | `/datasets?name=&format=` | upload (raw body); 202, or 200 if identical content exists |
| GET | `/datasets`, `/datasets/{id}` | list / detail with counts and ingest job |
| POST, DELETE | `/datasets/{id}/ingest`, `/datasets/{id}` | re-run validation / soft delete |
| GET | `/datasets/{id}/report`, `/datasets/{id}/report/download` | validation summary / full report |
| GET | `/datasets/{id}/designs`, `/designs/{id}` | design summaries / full design |
| POST | `/batches` | `{dataset_id, design_ids?, seed?, name?, fitness?, method?, population_size?, generations?, mutation_rate?, crossover_rate?, elitism?, tournament_size?}` + optional `Idempotency-Key`; 422 if the objective cannot score a design (up to 20 listed with the reason), and nothing is created |
| GET | `/datasets/{id}/compatibility?fitness=` | per design `{design_id, external_id, compatible, reason}` (paged like `/designs`) |
| GET | `/batches`, `/batches/{id}`, `/batches/{id}/jobs` | batch list / status and counts / jobs |
| POST | `/batches/{id}/cancel` | cancel unfinished jobs |
| GET | `/jobs/{id}`, `/jobs/{id}/result` | job status and progress / full result incl. fitness history, final-population ranking |
| GET | `/jobs/{id}/history` | recorded best/mean fitness per generation (`source`: result, live or unavailable) |
| GET | `/structures/tools` | whether oxDNA / tacoxDNA are configured (files checked, not executed) |
| POST | `/jobs/{id}/cancel`, `/jobs/{id}/retry` | cancel (queued or running) / retry (failed or cancelled) |
| POST | `/structures?name=&format=oxdna\|cadnano&design_id=` | upload caDNAno JSON or oxDNA topology (raw body) |
| PUT | `/structures/{id}/configuration` | upload oxDNA configuration (raw body); starts validation |
| POST | `/structures/{id}/validate`, `/structures/{id}/convert?lattice=square\|honeycomb` | re-validate / tacoxDNA conversion (optional) |
| GET | `/structures?design_id=`, `/structures/{id}`, `/structures/{id}/geometry?job_id=` | list / status, summary, issues, mapping / coordinates (with optional variant annotations) |

All errors are `application/problem+json` (RFC 9457). All paths are under `/api/v1`.

## Configuration (environment variables)

All variables are in [.env.example](.env.example). Containers get their MongoDB and Redis connection strings from
Compose, which builds them from the passwords below.

| Variable | Default | Purpose |
|---|---|---|
| `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD` | `origami` / *change-me* | MongoDB root login. **Set before first start**: MongoDB keeps the password chosen when its volume is created. |
| `REDIS_PASSWORD` | *change-me* | Redis password |
| `ORIGAMI_MONGO_URI`, `ORIGAMI_REDIS_URL` | localhost URLs | Only for running the API, CLI or tests **on the host**; must contain the same passwords |
| `ORIGAMI_CORS_ORIGINS` | `http://localhost:5173` | Comma-separated browser origins allowed by CORS |
| `ORIGAMI_OPTIMIZE_CONCURRENCY` | `2` | Optimization jobs run in parallel (optimize worker processes) |
| `INGEST_CONCURRENCY` | `2` | Ingest worker processes |
| `ORIGAMI_MAX_UPLOAD_BYTES` | 500 MiB | Upload limit, enforced while streaming |
| `ORIGAMI_MAX_JSON_BODY_BYTES` | 1 MiB | Limit for all other request bodies |
| `ORIGAMI_INGEST_*` | see file | Row, design, error, length and size limits for ingestion |
| `ORIGAMI_BATCH_MAX_DESIGNS` | `1000` | Designs per batch |
| `ORIGAMI_GA_MAX_POPULATION`, `ORIGAMI_GA_MAX_GENERATIONS` | `500`, `1000` | Upper limits for GA settings in `POST /batches` |
| `ORIGAMI_EXHAUSTIVE_AUTO_MAX` | `4096` | Method `auto` enumerates designs with at most this many combinations |
| `ORIGAMI_EXHAUSTIVE_MAX_COMBINATIONS` | `1048576` | Largest search space accepted for method `exhaustive` |
| `ORIGAMI_JOB_STALE_AFTER_S` | `300` | No heartbeat for this long: the job's worker is presumed lost |
| `ORIGAMI_JOB_MAX_STALE_REQUEUES` | `2` | Automatic requeues of a lost job before it is marked failed |
| `ORIGAMI_REAPER_INTERVAL_S` | `60` | How often the reaper runs |
| `ORIGAMI_MAX_STRUCTURE_BYTES` | 100 MiB | Per structure file upload |
| `ORIGAMI_STRUCTURE_MAX_NUCLEOTIDES` | `500000` | Largest accepted structure |
| `ORIGAMI_TACOXDNA_DIR` | unset | In-container path to tacoxDNA's `src` (enables `/convert`) |
| `ORIGAMI_CONVERTER_TIMEOUT_S` | `600` | Conversion time limit |

Passwords must not contain `@ : / ? # [ ] %` (they are embedded in connection URLs). Generate one with
`backend\.venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(24))"`.

## Tests and checks

```powershell
cd backend
.venv\Scripts\python -m pytest                       # unit + API tests, in-memory MongoDB; no services needed
.venv\Scripts\python -m pytest -m slow               # scale test (~120 MB files, several minutes)
.venv\Scripts\python -m ruff check src tests scripts
.venv\Scripts\python -m ruff format --check src tests scripts
.venv\Scripts\python -m mypy

# End-to-end against the real MongoDB in Docker (upload -> ingest -> batch -> optimize -> result).
# Uses a temporary database that is dropped afterwards. Type the password when prompted; it isn't stored.
$p = Read-Host "MongoDB password"
$env:ORIGAMI_TEST_MONGO_URI = "mongodb://origami:$p@localhost:27017/?authSource=admin"
.venv\Scripts\python -m pytest -m services
Remove-Item Env:ORIGAMI_TEST_MONGO_URI

cd ..\frontend
npm test
npm run typecheck
npm run lint
npm run build
npm run gen:api                                       # regenerate API types after backend API changes
```

## Objectives (fitness functions)

Choose the objective per batch (UI selector, or `"fitness"` in `POST /batches`); `GET /fitness-functions` lists each
objective's description, limitations and data requirements. **Both are computational proxies; neither predicts
folding yield, stability or kinetics.**

| Objective | Basis | Needs |
|---|---|---|
| `synthetic_gc_balance_demo` (default) | Demonstration only: mean deviation of staple GC fraction from 0.5. GC balance alone does not predict folding quality. | designs marked `metadata.source = "synthetic"` |
| `staple_scaffold_complementarity` | Watson–Crick pairing: each staple should be the reverse complement of the scaffold segment it binds; score = mean fraction of complementary bases (1.0 = no mismatches). | scaffold sequence; `start`/`end` per staple with `end - start + 1` = length (one contiguous segment) |

**Not implemented, and why** (no formula is substituted):
- Duplex stability (nearest-neighbour ΔG / melting temperature): needs a vetted thermodynamic implementation with
  mismatch and salt corrections (for example primer3 or NUPACK). Not bundled and not validated here.
- Folding yield or quality: needs experimental measurements (none are in the data) or validated predictive models.
- Structural strain or defects: needs molecular coordinates (M7 oxDNA import) plus simulation such as oxDNA.
- Staples crossing helices: the CSV schema has one contiguous `start..end` per staple.

### Optimizer evaluation

`backend\scripts\evaluate_optimizers.py` compares the GA (fixed defaults, seeds 42, 1, 2, 3, 4) with uniform random
search given the **same number of distinct evaluations**, and with exhaustive enumeration (the true optimum), on
synthetic 2^N problems. Results: [docs/benchmarks/optimizer_evaluation.csv](docs/benchmarks/optimizer_evaluation.csv)
(and `.json`).

```powershell
cd backend
.venv\Scripts\python scripts\evaluate_optimizers.py --out ..\docsenchmarks\optimizer_evaluation
```

Measured 2026-10-10 (host Windows ARM64, emulated x64 Python), 5 seeds each:

| Genes (combinations) | Objective | GA hits optimum | Random hits (same budget) | GA distinct evals (mean) | GA runtime (mean) | Exhaustive runtime |
|---|---|---|---|---|---|---|
| 8 (256) | GC demo | 5/5 | 5/5 | 138 | 0.40 s | 0.02 s |
| 8 (256) | complementarity | 5/5 | 1/5 | 118 | 0.42 s | 0.03 s |
| 12 (4,096) | GC demo | 5/5 | 3/5 | 396 | 0.55 s | 0.52 s |
| 12 (4,096) | complementarity | 5/5 | 0/5 | 328 | 0.74 s | 0.88 s |
| 16 (65,536) | GC demo | 5/5 | 3/5 | 1,238 | 0.80 s | 11.1 s |
| 16 (65,536) | complementarity | 5/5 | 0/5 | 686 | 0.63 s | 16.8 s |

Seed-42 reruns were identical for GA and random search. These are small, synthetic, single-variant problems
(complementarity's optimum is simply "keep every original staple"); results say nothing about larger or real designs.

## Benchmark

`backend\scripts\benchmark_optimizer.py` times the optimizer with the fixed M2 settings (population 50, 100
generations, seed 42) on synthetic designs with one supplied variant per staple, and checks that repeated runs are
identical. It measures speed and determinism only; the demo fitness values are not scientific results.

```powershell
cd backend
.venv\Scripts\python scripts\benchmark_optimizer.py --repeats 3
Get-Content scripts\benchmark_optimizer.py | docker compose exec -T api python - --sizes 3 25 100   # same in the container
```

Measured 2026-10-10 on the development machine (Windows 11 on ARM64; the host Python is an x64 build running under
emulation), 3 repeats each:

| Genes (staples with variants) | Median runtime | Min / max | Identical across repeats |
|---|---|---|---|
| 3 | 0.389 s | 0.324 / 0.427 s | yes |
| 25 | 1.685 s | 1.657 / 2.063 s | yes |
| 100 | 11.429 s | 8.638 / 12.078 s | yes |
| 250 | 31.459 s | 30.821 / 32.070 s | yes |

Same script inside the API container (Linux, native ARM64, Python 3.12), same day, 3 repeats each:

| Genes | Median runtime | Min / max | Identical across repeats | Same best fitness as host |
|---|---|---|---|---|
| 3 | 0.189 s | 0.144 / 0.201 s | yes | yes |
| 25 | 0.807 s | 0.779 / 0.832 s | yes | yes |
| 100 | 4.201 s | 3.979 / 4.313 s | yes | yes |

Runtime grows with design size because each candidate decodes and scores every staple. Your numbers will differ by
machine; rerun the script rather than relying on these.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `The token '&&' is not a valid statement separator` | Windows PowerShell 5.1: run commands on separate lines or join with `;`. |
| `/ready` shows `mongo: error` after changing `MONGO_ROOT_PASSWORD` | MongoDB kept the password from first start. Put the old password back. Resetting means deleting the `origami-evolve_mongo-data` volume, which **deletes all data**. |
| Host tests or CLI can't log in to MongoDB/Redis | `ORIGAMI_MONGO_URI` / `ORIGAMI_REDIS_URL` in `.env` still contain placeholders or old passwords. |
| `port is already allocated` (8000, 27017, 6379, 5173) | Another process uses the port: `Get-NetTCPConnection -LocalPort 8000 -State Listen`. |
| Frontend shows "API unreachable" | API container down: `docker compose --profile full ps`, then `docker compose logs api --tail 50`. |
| Jobs stay `queued` | Optimize worker not running: `docker compose --profile full ps`; `docker compose start worker-optimize`. Queued jobs run once it's back. |
| A job stays `running` after a worker crash | The reaper requeues it after `ORIGAMI_JOB_STALE_AFTER_S` (5 min) plus up to one reaper interval. |
| 401 "Invalid or revoked token" | Check `list-tokens`. Make sure you send exactly the `oe_...` value (no truncation), with `Authorization: Bearer <token>`. Revoked tokens fail immediately. |
| 401 "Malformed bearer token: it contains spaces" | Extra text was captured with the token; create tokens with `docker compose exec -T ...`. |
| 3D viewer: "3D rendering is unavailable" | WebGL is disabled or unsupported in the browser; enable hardware acceleration. |
| Container logs | `docker compose logs <service> --tail 100` (services: api, worker-ingest, worker-optimize, beat, mongo, redis). |

## Current limitations

- **Molecular coordinates only from imported oxDNA files.** OrigamiEvolve never generates, relaxes or simulates
  structures; it shows what the file contains. caDNAno files are topology only; dataset CSV/JSON still carry no
  coordinates. No real oxDNA file or tacoxDNA installation has been tested yet (only synthetic test files and a
  stand-in converter). There is no structure upload screen (API only).
- **Imported structures are not linked to fitness.** A structure shows the original sequences; selected variants are
  annotations, and a fitness score says nothing about whether the structure or a variant folds.
- Circular scaffolds stored with a different start position than the design's scaffold are not matched.
- **Fitness is a demo.** `synthetic_gc_balance_demo` only accepts designs marked `metadata.source = "synthetic"`.
  Real designs need a scientifically justified fitness plugin first.
- **No production frontend deployment.** The UI runs on the Vite dev server; there is no built-frontend container or
  reverse proxy, and no TLS.
- **No rate limiting** and no multi-user accounts or roles (single tenant with static tokens).
- **No mid-run GA checkpoints**: a requeued job restarts from generation 0 (deterministic with a fixed seed).
- The concurrency limit is per optimize-worker container; scaling that service multiplies it.
- File storage is a local Docker volume; no S3 adapter and no automated retention or cleanup yet.

## Security

- MongoDB, Redis and the API are bound to `127.0.0.1`; MongoDB and Redis require passwords.
- Secrets live only in `.env` (git-ignored and excluded from Docker builds). Logs and docs never contain them.
- Bearer tokens: 256-bit random, stored as SHA-256 hashes, revocable immediately.
- Uploads: size enforced while streaming, content sniffed against the declared format, server-generated storage keys
  (no path traversal). Other request bodies are capped (`ORIGAMI_MAX_JSON_BODY_BYTES`); requests without a length are refused.
- Request models reject unknown fields; Mongo queries are built from typed values only.
- Responses carry `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store` and a restrictive `Content-Security-Policy`. Errors, including unexpected ones, are generic
  problem+json without internals.
- CORS allowlist; Celery accepts JSON only; containers run as a non-root user.

## Repository layout

```
backend/   src/origami_core · src/origami_api · src/origami_worker · scripts/ · tests/unit · tests/integration
frontend/  src/api (generated types) · src/features/{datasets,designs,batches,structures,viewer} · src/components · tests/
examples/  synthetic example datasets (random sequences, not real designs)
docs/      PLAN.md (plan + deviations) · input-formats.md (formats + validation codes)
docker-compose.yml · .env.example
```
