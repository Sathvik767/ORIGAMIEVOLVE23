"""Semantic checks shared by all readers. Each problem gets a stable code (see docs/input-formats.md).

These are *data-integrity* checks only (alphabet, coordinates, sizes). They say nothing
about whether a design is physically plausible.
"""

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass

from origami_core.ingest.limits import IngestLimits
from origami_core.ingest.report import Issue
from origami_core.models import Design, Strand

_ACGT = re.compile(r"^[ACGT]+$")
_ACGTN = re.compile(r"^[ACGTN]+$")


@dataclass(frozen=True)
class SourceLines:
    """Physical line of each strand and variant (CSV), so issues point at the offending row.
    Anything not listed falls back to the design's own location."""

    scaffold: int | None = None
    staples: tuple[int, ...] = ()
    candidates: tuple[tuple[int, ...], ...] = ()  # per staple, per candidate


def normalize_sequence(seq: str) -> str:
    return seq.strip().upper()


def _check_sequence(
    seq: str, max_len: int, limits: IngestLimits, field: str, design_id: str, loc: int | None
) -> Iterable[Issue]:
    if not seq:
        yield Issue("E_REQUIRED", "Sequence is empty", location=loc, design_id=design_id, field=field)
        return
    if len(seq) > max_len:
        yield Issue(
            "E_LENGTH",
            f"Sequence length {len(seq)} exceeds limit {max_len}",
            location=loc,
            design_id=design_id,
            field=field,
        )
    pattern = _ACGTN if limits.allow_n else _ACGT
    if not pattern.match(seq):
        bad = sorted(set(seq) - set("ACGTN" if limits.allow_n else "ACGT"))[:5]
        yield Issue(
            "E_ALPHABET",
            f"Invalid characters {bad!r}; allowed: {'ACGTN' if limits.allow_n else 'ACGT'}",
            location=loc,
            design_id=design_id,
            field=field,
        )


def _check_strand(
    s: Strand,
    max_len: int,
    limits: IngestLimits,
    design_id: str,
    loc: int | None,
    scaffold_len: int | None,
    candidate_locs: tuple[int, ...] = (),
) -> Iterable[Issue]:
    prefix = f"strand[{s.id}]"
    yield from _check_sequence(s.sequence, max_len, limits, f"{prefix}.sequence", design_id, loc)
    for name, value in (("helix", s.helix), ("start", s.start), ("end", s.end)):
        if value is not None and value < 0:
            yield Issue(
                "E_RANGE", f"{name} must be >= 0", location=loc, design_id=design_id, field=f"{prefix}.{name}"
            )
    if s.start is not None and s.end is not None and s.start > s.end:
        yield Issue("E_RANGE", "start must be <= end", location=loc, design_id=design_id, field=prefix)
    if scaffold_len is not None and s.end is not None and s.end >= scaffold_len:
        yield Issue(
            "E_COORD_OUT_OF_RANGE",
            f"end {s.end} is outside scaffold length {scaffold_len}",
            location=loc,
            design_id=design_id,
            field=f"{prefix}.end",
        )
    if len(s.candidates) > limits.max_candidates_per_staple:
        yield Issue(
            "E_LIMIT",
            f"{len(s.candidates)} candidates exceeds limit {limits.max_candidates_per_staple}",
            location=loc,
            design_id=design_id,
            field=f"{prefix}.candidates",
        )
    for i, cand in enumerate(s.candidates):
        cand_loc = candidate_locs[i] if i < len(candidate_locs) else loc
        yield from _check_sequence(cand, max_len, limits, f"{prefix}.candidates[{i}]", design_id, cand_loc)


def validate_design(
    design: Design, limits: IngestLimits, loc: int | None, lines: SourceLines | None = None
) -> list[Issue]:
    did = design.external_id
    lines = lines or SourceLines()
    issues: list[Issue] = []
    scaffold_len = len(design.scaffold.sequence) if design.scaffold else None

    if design.scaffold is None:
        issues.append(
            Issue(
                "W_NO_SCAFFOLD",
                "Design has no scaffold strand; coordinate checks skipped",
                severity="warning",
                location=loc,
                design_id=did,
            )
        )
    else:
        scaffold_loc = lines.scaffold or loc
        issues.extend(
            _check_strand(design.scaffold, limits.max_scaffold_length, limits, did, scaffold_loc, None)
        )

    if not design.staples:
        issues.append(Issue("E_NO_STAPLES", "Design has no staple strands", location=loc, design_id=did))
    if len(design.staples) > limits.max_staples_per_design:
        issues.append(
            Issue(
                "E_LIMIT",
                f"{len(design.staples)} staples exceeds limit {limits.max_staples_per_design}",
                location=loc,
                design_id=did,
                field="staples",
            )
        )

    seen: set[str] = {design.scaffold.id} if design.scaffold else set()
    for idx, s in enumerate(design.staples):
        s_loc = lines.staples[idx] if idx < len(lines.staples) else loc
        c_locs = lines.candidates[idx] if idx < len(lines.candidates) else ()
        if s.id in seen:
            issues.append(
                Issue(
                    "E_DUPLICATE_STRAND",
                    f"Strand id {s.id!r} appears more than once",
                    location=s_loc,
                    design_id=did,
                    field=f"strand[{s.id}]",
                )
            )
        seen.add(s.id)
        issues.extend(_check_strand(s, limits.max_staple_length, limits, did, s_loc, scaffold_len, c_locs))

    if len(json.dumps(design.metadata, default=str)) > limits.max_metadata_bytes:
        issues.append(
            Issue(
                "E_LIMIT",
                f"metadata exceeds {limits.max_metadata_bytes} bytes",
                location=loc,
                design_id=did,
                field="metadata",
            )
        )
    if len(design.model_dump_json()) > limits.max_design_bytes:
        issues.append(
            Issue(
                "E_DESIGN_TOO_LARGE",
                f"Design exceeds {limits.max_design_bytes} bytes",
                location=loc,
                design_id=did,
            )
        )
    return issues
