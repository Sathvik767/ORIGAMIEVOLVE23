"""Streaming reader for the long-format CSV (one row per strand).

Assumption (docs/input-formats.md): all rows of a design are contiguous. This keeps memory
bounded to a single design; a design_id that reappears later is reported as E_DUPLICATE_DESIGN.
"""

import csv
import io
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, BinaryIO

from origami_core.ingest.common import finish_design
from origami_core.ingest.limits import IngestLimits
from origami_core.ingest.report import Issue, ValidationReport
from origami_core.ingest.validation import SourceLines, normalize_sequence
from origami_core.models import Design, Measurement, MetadataValue, Strand

REQUIRED_COLUMNS = ("design_id", "strand_id", "strand_type", "sequence")
KNOWN_COLUMNS = frozenset({*REQUIRED_COLUMNS, "design_name", "helix", "start", "end", "candidate_group"})
MEASUREMENT_PREFIX = "meas_"
STRAND_TYPES = frozenset({"scaffold", "staple", "staple_variant"})


@dataclass
class _Acc:
    design_id: str
    first_line: int
    name: str | None = None
    scaffold: dict[str, Any] | None = None
    staples: list[dict[str, Any]] = field(default_factory=list)
    variants: list[tuple[str, str, int]] = field(default_factory=list)
    metadata: dict[str, MetadataValue] = field(default_factory=dict)
    measurements: dict[str, float] = field(default_factory=dict)
    invalid: bool = False


def read_csv(stream: BinaryIO, limits: IngestLimits, report: ValidationReport) -> Iterator[Design]:
    # Global to the csv module; sized so a legitimate scaffold always fits in one field.
    csv.field_size_limit(max(limits.max_scaffold_length, limits.max_staple_length, 1 << 16) * 2)
    text = io.TextIOWrapper(stream, encoding="utf-8-sig", newline="")
    reader = csv.reader(text)
    try:
        yield from _read_rows(reader, limits, report)
    except UnicodeDecodeError as exc:
        report.abort(Issue("E_ENCODING", f"File is not valid UTF-8 near byte {exc.start}"))
    except csv.Error as exc:
        report.abort(
            Issue("E_CSV", f"Malformed CSV at line {reader.line_num}: {exc}", location=reader.line_num)
        )
    finally:
        text.detach()  # leave the caller's stream open


def _read_rows(reader: Any, limits: IngestLimits, report: ValidationReport) -> Iterator[Design]:
    try:
        header = [h.strip() for h in next(reader)]
    except StopIteration:
        report.abort(Issue("E_EMPTY", "File is empty"))
    missing = [c for c in REQUIRED_COLUMNS if c not in header]
    if missing:
        report.abort(Issue("E_MISSING_COLUMN", f"Missing required columns: {', '.join(missing)}", location=1))
    if len(set(header)) != len(header):
        report.abort(Issue("E_DUPLICATE_COLUMN", "Header contains duplicate column names", location=1))
    col = {name: i for i, name in enumerate(header)}
    extra_cols = [h for h in header if h not in KNOWN_COLUMNS and h]

    acc: _Acc | None = None
    seen: set[str] = set()

    for row in reader:
        if not row or not any(cell.strip() for cell in row):
            continue
        line = reader.line_num
        report.records_read += 1
        if report.records_read > limits.max_rows:
            report.abort(Issue("E_ROW_LIMIT", f"More than {limits.max_rows} rows", location=line))

        did = row[col["design_id"]].strip() if len(row) > col["design_id"] else ""
        if not did:
            report.add(Issue("E_REQUIRED", "design_id is empty", location=line, field="design_id"))
            continue

        if acc is None or did != acc.design_id:
            if acc is not None:
                if (design := _flush(acc, limits, report)) is not None:
                    yield design
            acc = _Acc(design_id=did, first_line=line)
            if did in seen:
                acc.invalid = True
                report.add(
                    Issue(
                        "E_DUPLICATE_DESIGN",
                        f"Rows for design {did!r} are not contiguous or repeat",
                        location=line,
                        design_id=did,
                    )
                )
            seen.add(did)
            if len(seen) > limits.max_designs:
                report.abort(
                    Issue("E_DESIGN_LIMIT", f"More than {limits.max_designs} designs", location=line)
                )

        def err(
            code: str, message: str, fld: str | None = None, *, _acc: _Acc = acc, _line: int = line
        ) -> None:
            _acc.invalid = True
            report.add(Issue(code, message, location=_line, design_id=_acc.design_id, field=fld))

        if len(row) != len(header):
            err("E_COLUMN_COUNT", f"Expected {len(header)} columns, found {len(row)}")
            continue
        _absorb_row(row, col, extra_cols, acc, err, line)

    if acc is not None and (design := _flush(acc, limits, report)) is not None:
        yield design


def _absorb_row(
    row: list[str], col: dict[str, int], extra_cols: list[str], acc: _Acc, err: Any, line: int
) -> None:
    def cell(name: str) -> str:
        return row[col[name]].strip() if name in col else ""

    def as_int(name: str) -> int | None:
        raw = cell(name)
        if not raw:
            return None
        try:
            return int(raw)
        except ValueError:
            err("E_INTEGER", f"{name} must be an integer, got {raw[:32]!r}", name)
            return None

    strand_id, strand_type, sequence = cell("strand_id"), cell("strand_type").lower(), cell("sequence")
    if not strand_id:
        err("E_REQUIRED", "strand_id is empty", "strand_id")
        return
    if strand_type not in STRAND_TYPES:
        err("E_STRAND_TYPE", f"strand_type must be one of {sorted(STRAND_TYPES)}", "strand_type")
        return

    _merge(acc, "name", None, cell("design_name"), err)
    for name in extra_cols:
        value = cell(name)
        if not value:
            continue
        if name.startswith(MEASUREMENT_PREFIX):
            try:
                _merge(acc, "measurements", name[len(MEASUREMENT_PREFIX) :], float(value), err)
            except ValueError:
                err("E_NUMBER", f"{name} must be numeric, got {value[:32]!r}", name)
        else:
            _merge(acc, "metadata", name, value, err)

    seq = normalize_sequence(sequence)
    if strand_type == "staple_variant":
        group = cell("candidate_group")
        if not group:
            err("E_REQUIRED", "staple_variant rows need candidate_group", "candidate_group")
        else:
            acc.variants.append((group, seq, line))
        return

    strand: dict[str, Any] = {
        "id": strand_id,
        "sequence": seq,
        "helix": as_int("helix"),
        "start": as_int("start"),
        "end": as_int("end"),
        "candidates": [],
        "line": line,
    }
    if strand_type == "scaffold":
        if acc.scaffold is not None:
            err("E_MULTIPLE_SCAFFOLDS", "Design has more than one scaffold row", "strand_type")
        else:
            acc.scaffold = strand
    else:
        acc.staples.append(strand)


def _merge(acc: _Acc, attr: str, key: str | None, value: Any, err: Any) -> None:
    """Design-level values may repeat on every row, but must not conflict."""
    if value in ("", None):
        return
    if key is None:
        current = getattr(acc, attr)
        if current is not None and current != value:
            err("E_CONFLICTING_VALUE", f"Conflicting {attr} values for design", attr)
        setattr(acc, attr, value)
        return
    target: dict[str, Any] = getattr(acc, attr)
    if key in target and target[key] != value:
        err("E_CONFLICTING_VALUE", f"Conflicting values for {key!r} within design", key)
    target[key] = value


def _flush(acc: _Acc, limits: IngestLimits, report: ValidationReport) -> Design | None:
    by_id = {s["id"]: s for s in acc.staples}
    for s in acc.staples:
        s["candidate_lines"] = []
    for group, seq, line in acc.variants:
        if group not in by_id:
            acc.invalid = True
            report.add(
                Issue(
                    "E_UNKNOWN_CANDIDATE_GROUP",
                    f"candidate_group {group!r} matches no staple",
                    location=line,
                    design_id=acc.design_id,
                    field="candidate_group",
                )
            )
        else:
            by_id[group]["candidates"].append(seq)
            by_id[group]["candidate_lines"].append(line)

    def strand(raw: dict[str, Any]) -> Strand:
        fields = {k: v for k, v in raw.items() if k not in ("line", "candidate_lines")}
        return Strand(**{**fields, "candidates": tuple(raw.get("candidates", ()))})

    def build() -> Design:
        return Design(
            external_id=acc.design_id,
            name=acc.name,
            scaffold=strand({**acc.scaffold, "candidates": ()}) if acc.scaffold else None,
            staples=tuple(strand(s) for s in acc.staples),
            metadata=acc.metadata,
            measurements=tuple(Measurement(name=k, value=v) for k, v in acc.measurements.items()),
        )

    lines = SourceLines(
        scaffold=acc.scaffold["line"] if acc.scaffold else None,
        staples=tuple(s["line"] for s in acc.staples),
        candidates=tuple(tuple(s["candidate_lines"]) for s in acc.staples),
    )
    return finish_design(
        build, acc.design_id, acc.first_line, limits, report, already_invalid=acc.invalid, lines=lines
    )
