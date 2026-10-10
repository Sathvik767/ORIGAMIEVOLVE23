# Input formats

> **Status: assumed formats, pending real example files.** These shapes are the documented
> assumptions from [PLAN.md](PLAN.md) §4.3/§9. Each reader sits behind the same interface
> (`origami_core.ingest.parse_designs`), so caDNAno, scadnano or oxDNA adapters can be added
> later without changing the rest of the system.

All formats map to one canonical model: **design = scaffold + staples (+ optional staple
variants, metadata, imported measurements)**. The checks below are about *data integrity*
only. They say nothing about whether a design folds or is stable.

Example files (synthetic, random sequences) are in [`examples/`](../examples). Regenerate or
scale them with `backend/scripts/generate_synthetic.py`.

## Upload

`POST /api/v1/datasets?name=<name>&format=csv|ndjson|json[&filename=..][&description=..]`.
The **raw file is the request body**, with `Authorization: Bearer <token>`.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" --data-binary @examples/synthetic_designs.csv "http://localhost:8000/api/v1/datasets?name=Example&format=csv"
```

The body is streamed straight to storage with a byte limit (`ORIGAMI_MAX_UPLOAD_BYTES`,
500 MB by default) and a SHA-256 checksum. Multipart forms are not used: Starlette spools a
multipart body to an unbounded temporary file before the handler runs, so the size limit
could not be enforced while streaming.

| Response | Meaning |
|---|---|
| `202` | Stored; an ingest job is queued (`dataset.ingest_job`) |
| `200` + `duplicate: true` | Identical content (same SHA-256) already exists; the existing dataset is returned |
| `413` | Too large (checked against `Content-Length` first, then while streaming) |
| `415` | Content doesn't look like the declared format (first 4 KB sniffed) |
| `422` | Empty body or invalid query parameters |

Ingestion runs in the worker. A design with **any** error is rejected whole; only valid
designs are stored. The dataset ends up `ready`, `ready_with_errors` or `failed`.

## CSV (long format: one row per strand)

| Column | Required | Notes |
|---|---|---|
| `design_id` | yes | Rows of one design **must be contiguous** (keeps memory bounded to one design) |
| `strand_id` | yes | Unique within the design |
| `strand_type` | yes | `scaffold` (at most one per design), `staple`, or `staple_variant` |
| `sequence` | yes | `A C G T`, case-insensitive (`N` only if `ORIGAMI_INGEST_ALLOW_N=true`) |
| `helix`, `start`, `end` | no | Non-negative integers; `start <= end`; `end` < scaffold length |
| `candidate_group` | variants only | The `strand_id` of the staple this variant is an alternative for |
| `design_name` | no | Must not conflict between rows of a design |
| `meas_<name>` | no | Numeric **imported measurement** (e.g. `meas_gel_yield`), stored with `source: user_import` |
| any other column | no | Stored as string metadata; must not conflict between rows of a design |

```csv
design_id,strand_id,strand_type,sequence,helix,start,end,candidate_group,meas_gel_yield
tile_1,scaf,scaffold,ACGT...,,,,,0.42
tile_1,s1,staple,ACGTACGT,0,0,7,,
tile_1,s1_v1,staple_variant,ACGTACGA,,,,s1,
```

UTF-8 (BOM allowed), comma-separated, RFC 4180 quoting, CRLF or LF line endings.

## NDJSON (one design per line; preferred for large files)

```json
{"design_id": "tile_1", "name": "Tile 1",
 "scaffold": {"id": "scaf", "sequence": "ACGT..."},
 "staples": [{"id": "s1", "sequence": "ACGTACGT", "helix": 0, "start": 0, "end": 7, "candidates": ["ACGTACGA"]}],
 "metadata": {"batch": "B7"},
 "measurements": [{"name": "gel_yield", "value": 0.42, "unit": "fraction", "method": "agarose gel"}]}
```

(Shown wrapped here; each record must be on one line.) Unknown fields are rejected.
`geometry` is not accepted in dataset records. Molecular coordinates come only from imported oxDNA structure files
(see [Structure files](#structure-files)); without one, the 3D viewer draws an index-space schematic from staple
`helix`, `start` and `end`. A malformed line is
reported and skipped, and parsing continues. Lines are capped at `ORIGAMI_INGEST_MAX_LINE_BYTES`.

## JSON array

A top-level array of the same objects as NDJSON, parsed incrementally (`ijson`). Truncated or
structurally malformed JSON stops ingestion (`E_JSON`). Locations in the report are 0-based
array indices instead of line numbers.

## Validation codes

Errors (`E_*`) reject the design; warnings (`W_*`) do not. Fatal codes stop ingestion
entirely, and then no designs are stored.

| Code | Fatal | Meaning |
|---|---|---|
| `E_ALPHABET` | | Sequence contains characters other than ACGT (or N when allowed) |
| `E_COLUMN_COUNT` | | Row has a different number of columns than the header |
| `E_CONFLICTING_VALUE` | | A design-level value differs between rows of one design |
| `E_COORD_OUT_OF_RANGE` | | `end` is at or beyond the scaffold length |
| `E_CSV` | ✓ | Malformed CSV (e.g. unbalanced quotes) |
| `E_DESIGN_LIMIT` | ✓ | More than `ORIGAMI_INGEST_MAX_DESIGNS` designs |
| `E_DESIGN_TOO_LARGE` | | Design exceeds `ORIGAMI_INGEST_MAX_DESIGN_BYTES` |
| `E_DUPLICATE_COLUMN` | ✓ | Header repeats a column |
| `E_DUPLICATE_DESIGN` | | `design_id` repeats (CSV: rows not contiguous) |
| `E_DUPLICATE_STRAND` | | Strand id repeats within a design |
| `E_EMPTY` | ✓ | Empty file |
| `E_ENCODING` | CSV ✓ | Not valid UTF-8 (NDJSON: only that line is skipped) |
| `E_INTEGER` | | `helix`/`start`/`end` is not an integer |
| `E_JSON` | array ✓ | Invalid JSON (NDJSON: only that line is skipped) |
| `E_LENGTH` | | Sequence exceeds `ORIGAMI_INGEST_MAX_SCAFFOLD_LENGTH` / `..._STAPLE_LENGTH` |
| `E_LIMIT` | | Too many staples or candidates, or metadata too large |
| `E_LINE_TOO_LONG` | | NDJSON line exceeds the limit |
| `E_MISSING_COLUMN` | ✓ | Required CSV column missing |
| `E_MULTIPLE_SCAFFOLDS` | | More than one scaffold in a design |
| `E_NO_STAPLES` | | Design has no staples |
| `E_NO_VALID_DESIGNS` | ✓ | Nothing valid to store |
| `E_NUMBER` | | `meas_*` value is not numeric |
| `E_RANGE` | | Negative coordinate, or `start > end` |
| `E_REQUIRED` | | Required value empty |
| `E_ROW_LIMIT` | ✓ | More than `ORIGAMI_INGEST_MAX_ROWS` rows/records |
| `E_SCHEMA` | | JSON record doesn't match the schema |
| `E_STRAND_TYPE` | | Unknown `strand_type` |
| `E_TOO_MANY_ERRORS` | ✓ | More than `ORIGAMI_INGEST_MAX_ERRORS` errors |
| `E_UNKNOWN_CANDIDATE_GROUP` | | Variant points at a staple id that doesn't exist |
| `W_NO_SCAFFOLD` | | No scaffold, so coordinate checks were skipped |

The report stored on the dataset keeps counts per code and up to
`ORIGAMI_REPORT_SAMPLES_PER_CODE` samples (line or index, design, field, message). The full
issue list (capped at `ORIGAMI_REPORT_MAX_ISSUES`) is downloadable from
`GET /api/v1/datasets/{id}/report/download`.


## Structure files

Real structure files are imported separately from datasets, through `/api/v1/structures` (raw request bodies, like
dataset uploads; limit `ORIGAMI_MAX_STRUCTURE_BYTES`, default 100 MiB, and `ORIGAMI_STRUCTURE_MAX_NUCLEOTIDES`,
default 500,000). Validation runs in the worker. A structure ends up `ready` (coordinates available),
`topology_only` (caDNAno), or `invalid` (with coded issues and locations).

### oxDNA (coordinates)

Two files, uploaded in order: topology with `POST /structures?format=oxdna&name=...[&design_id=...]`, then
configuration with `PUT /structures/{id}/configuration`. Reference: the oxDNA documentation on configuration and
topology files.

| File | Accepted content |
|---|---|
| Topology, classic | Header `N_nucleotides N_strands`, then N lines `strand base n3 n5` (strand ids from 1; neighbours are nucleotide indices or `-1`) |
| Topology, new | Header `N_nucleotides N_strands 5->3`, then one line per strand: its sequence 5'→3', optional `circular=true` |
| Configuration | `t = ...`, `b = Lx Ly Lz`, `E = ...`, then N lines of at least 9 numbers: position `r`, unit vectors `a1` and `a3` (velocities ignored) |

Bases must be A, C, G or T (custom particle types are not supported). Lengths are oxDNA simulation units
(1 unit = 0.8518 nm). The viewer shows each nucleotide's stored position, only translated to the centre, with lines
between bonded neighbours. Nothing is generated, relaxed or "fixed".

### caDNAno 2 JSON (topology only)

`POST /structures?format=cadnano&name=...[&design_id=...]` with the caDNAno file as the body. Each vstrand needs
`num`, `row`, `col`, `scaf` and `stap`, where every position is `[prev_helix, prev_index, next_helix, next_index]`.
All links are checked for reciprocity, and helices, strands, crossovers and the array length are summarised. The
lattice is only hinted from the array length, because caDNAno 2 files don't record it. caDNAno files contain **no
coordinates and no sequences**, so they never produce a molecular view by themselves.

### Optional tacoxDNA conversion

`POST /structures/{id}/convert?lattice=square|honeycomb` runs tacoxDNA's `cadnano_oxDNA.py`. It requires
`ORIGAMI_TACOXDNA_DIR`, a lattice stated by you, and a linked design with a scaffold sequence, which is passed to
the converter so that no sequences are made up. The output is validated like any oxDNA upload, and the structure
records `conversion.tool`, `lattice` and `sequence_source`. This adapter has only been tested with a stand-in
script, not with tacoxDNA itself.

### Strand mapping to a design

With `design_id`, structure strands are matched to the design's scaffold and staples by **identical sequence, unique
match only** (5'→3', case-insensitive). The status is `verified` (scaffold and every staple matched), `partial` or
`unmatched`, with unmatched and ambiguous ids listed. `GET /structures/{id}/geometry?job_id=...` adds a completed
job's selected variants to mapped staples, with a `length_compatible` flag. It refuses (409) a job that optimized a
different design.

### Structure validation codes

| Code | Meaning |
|---|---|
| `E_TOP_EMPTY`, `E_TOP_HEADER`, `E_TOP_COUNT`, `E_TOP_LINE` | Topology missing, malformed header, wrong number of lines, malformed line |
| `E_TOP_BASE` | Base other than A/C/G/T |
| `E_TOP_STRAND` | Strand id out of range, or a strand without nucleotides |
| `E_TOP_NEIGHBOUR` | Neighbour index out of range |
| `E_TOP_LINKAGE` | Neighbour links not reciprocated, joining different strands, or a strand broken into pieces |
| `E_CONF_HEADER`, `E_CONF_COUNT`, `E_CONF_LINE`, `E_CONF_NUMBER` | Configuration header, line count, too few numbers, non-numeric or non-finite values |
| `E_CONF_ORIENTATION` | `a1` or `a3` is not a unit vector (tolerance 0.01) |
| `W_BOND_LENGTH` (warning) | Bonded neighbours more than 2 units apart (possibly wrapped across periodic boundaries); shown as stored |
| `E_CADNANO_JSON`, `E_CADNANO_SCHEMA` | Not JSON, or not the caDNAno 2 structure |
| `E_CADNANO_LINK` | A link points to a missing base or is not reciprocated |
| `E_CADNANO_EMPTY` | No scaffold bases |
| `E_LIMIT` | Size limits exceeded |
| `E_FILE`, `DISPATCH_FAILED` | File unreadable / queue unavailable (re-run with `POST /structures/{id}/validate`) |
