"""caDNAno 2 JSON validator (topology only).

Format: {"name": ..., "vstrands": [{"num", "row", "col", "scaf", "stap", "loop", "skip", ...}, ...]}.
"scaf"/"stap" hold one entry per base position: [prev_helix, prev_index, next_helix, next_index]
(the 5' and 3' neighbours; -1 = none). The file contains no coordinates and no sequences, so this
module only validates and summarises topology. Coordinates require an external converter (tacoxDNA).
"""

import json
from dataclasses import dataclass
from typing import Any

from origami_core.structure.common import IssueCollector, StructureLimits

Base = tuple[int, int]  # (helix num, index)


@dataclass(frozen=True)
class CadnanoSummary:
    name: str | None
    helices: int
    array_length: int
    scaffold_strands: int
    staple_strands: int
    scaffold_crossovers: int
    staple_crossovers: int
    scaffold_bases: int
    staple_bases: int
    lattice_hint: str

    def summary(self) -> dict[str, Any]:
        return {"format": "cadnano", **self.__dict__, "has_coordinates": False}


def _strands(kind: str, grid: dict[int, list[list[int]]], issues: IssueCollector) -> tuple[int, int, int]:
    """Validate links and trace strands. Returns (strands, crossovers, bases)."""

    def entry(b: Base) -> list[int] | None:
        h, i = b
        arr = grid.get(h)
        return arr[i] if arr is not None and 0 <= i < len(arr) else None

    used: set[Base] = set()
    crossovers = 0
    for h, arr in grid.items():
        for i, (ph, pi, nh, ni) in enumerate(arr):
            loc = f"vstrand {h} {kind}[{i}]"
            for label, th, ti, back in (("next", nh, ni, 0), ("prev", ph, pi, 2)):
                if th == -1 and ti == -1:
                    continue
                target = entry((th, ti))
                if target is None:
                    issues.add("E_CADNANO_LINK", f"{label} points to missing base ({th}, {ti})", loc)
                elif (target[back], target[back + 1]) != (h, i):
                    issues.add("E_CADNANO_LINK", f"{label} link to ({th}, {ti}) is not reciprocated", loc)
            if (nh, ni) != (-1, -1):
                used.add((h, i))
                crossovers += nh != h
            if (ph, pi) != (-1, -1):
                used.add((h, i))
    if issues.errors:
        return 0, 0, 0
    seen: set[Base] = set()
    count = 0
    starts = [b for b in used if tuple(entry(b)[:2]) == (-1, -1)]  # type: ignore[index]
    for start in starts + sorted(used):  # 5' ends first, then leftovers (circular strands)
        if start in seen:
            continue
        count += 1
        cur: Base | None = start
        while cur is not None and cur not in seen:
            seen.add(cur)
            e = entry(cur)
            nxt = (e[2], e[3]) if e else (-1, -1)
            cur = None if nxt == (-1, -1) else nxt
    return count, crossovers, len(used)


def parse_cadnano(text: str, limits: StructureLimits | None = None) -> CadnanoSummary:
    issues = IssueCollector(limits or StructureLimits())
    try:
        doc = json.loads(text)
    except json.JSONDecodeError as exc:
        issues.add("E_CADNANO_JSON", f"Invalid JSON: {exc.msg} (line {exc.lineno})")
        issues.raise_if_errors()
    vstrands = doc.get("vstrands") if isinstance(doc, dict) else None
    if not isinstance(vstrands, list) or not vstrands:
        issues.add(
            "E_CADNANO_SCHEMA", "Expected an object with a non-empty 'vstrands' list (caDNAno 2 format)"
        )
        issues.raise_if_errors()
    assert isinstance(vstrands, list)

    scaf: dict[int, list[list[int]]] = {}
    stap: dict[int, list[list[int]]] = {}
    length: int | None = None
    for k, vs in enumerate(vstrands):
        loc = f"vstrand #{k}"
        if not isinstance(vs, dict) or not all(key in vs for key in ("num", "row", "col", "scaf", "stap")):
            issues.add("E_CADNANO_SCHEMA", "Each vstrand needs num, row, col, scaf and stap", loc)
            continue
        num = vs["num"]
        if not isinstance(num, int) or num in scaf:
            issues.add("E_CADNANO_SCHEMA", f"Helix number {num!r} is missing or duplicated", loc)
            continue
        for kind, target in (("scaf", scaf), ("stap", stap)):
            arr = vs[kind]
            ok = isinstance(arr, list) and all(
                isinstance(e, list) and len(e) == 4 and all(isinstance(v, int) for v in e) for e in arr
            )
            if not ok:
                issues.add("E_CADNANO_SCHEMA", f"{kind} must be a list of [int, int, int, int]", loc)
                continue
            if length is None:
                length = len(arr)
            elif len(arr) != length:
                issues.add(
                    "E_CADNANO_SCHEMA", f"{kind} has {len(arr)} positions; other helices have {length}", loc
                )
            target[num] = arr
    issues.raise_if_errors()
    if length and length * len(scaf) * 2 > issues.limits.max_nucleotides * 4:
        issues.add("E_LIMIT", "Design exceeds the configured size limit")
        issues.raise_if_errors()

    scaffold_strands, scaffold_x, scaffold_bases = _strands("scaf", scaf, issues)
    staple_strands, staple_x, staple_bases = _strands("stap", stap, issues)
    issues.raise_if_errors()
    if scaffold_bases == 0:
        issues.add("E_CADNANO_EMPTY", "The design has no scaffold bases")
        issues.raise_if_errors()

    n = length or 0
    hint = (
        "multiple of 21 (consistent with honeycomb)"
        if n % 21 == 0 and n % 32
        else "multiple of 32 (consistent with square)"
        if n % 32 == 0 and n % 21
        else "undetermined"
    )
    # Each crossover is counted once, on the strand's 'next' link that changes helix.
    return CadnanoSummary(
        doc.get("name"),
        len(scaf),
        n,
        scaffold_strands,
        staple_strands,
        scaffold_x,
        staple_x,
        scaffold_bases,
        staple_bases,
        hint,
    )
