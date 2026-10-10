"""oxDNA topology (.top) + configuration (.dat/.oxdna) parser and validator.

Format reference: oxDNA documentation, "Configuration and topology files".
  * Classic topology: header "N S"; then N lines "strand base n3 n5" (strand 1-based, neighbours are
    nucleotide indices or -1). Configuration lines are in the same nucleotide order.
  * New topology: header "N S 5->3"; then one line per strand "SEQUENCE [key=value ...]" listed 5'->3',
    optional "circular=true". Nucleotides are numbered strand by strand in that order.
  * Configuration: "t = ...", "b = Lx Ly Lz", "E = ...", then N lines of >= 9 numbers:
    r (centre of mass), a1 (backbone-base unit vector), a3 (base normal unit vector), [v, L].
Lengths are oxDNA simulation units (1 unit = 0.8518 nm). Coordinates are used exactly as stored;
nothing is generated or relaxed here.
"""

import math
from dataclasses import dataclass
from typing import Any

from origami_core.structure.common import IssueCollector, StructureIssue, StructureLimits

OXDNA_LENGTH_UNIT_NM = 0.8518
BASES = frozenset("ACGT")
BONDED_DISTANCE_WARN = 2.0  # sim units; normal bonded CoM distance is ~0.6-0.8
STRAIGHT_TOLERANCE = 0.1  # sim units; helical DNA deviates far more than this from a straight line
STRAIGHT_MIN_LENGTH = 8  # only judge strands long enough to span most of a helical turn


@dataclass(frozen=True)
class Strand:
    index: int  # 0-based
    nucleotides: tuple[int, ...]  # nucleotide indices, 5' -> 3'
    sequence: str  # 5' -> 3'
    circular: bool


@dataclass(frozen=True)
class OxdnaStructure:
    topology_format: str  # "classic" | "new"
    n_nucleotides: int
    strands: tuple[Strand, ...]
    positions: tuple[tuple[float, float, float], ...]  # r per nucleotide, as stored
    box: tuple[float, float, float]
    warnings: tuple[StructureIssue, ...]

    def summary(self) -> dict[str, Any]:
        xs, ys, zs = zip(*self.positions, strict=True)
        return {
            "format": "oxdna",
            "topology_format": self.topology_format,
            "nucleotides": self.n_nucleotides,
            "strands": len(self.strands),
            "circular_strands": sum(s.circular for s in self.strands),
            "longest_strand": max(len(s.nucleotides) for s in self.strands),
            "box": list(self.box),
            "extent": [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)],
            "length_unit": f"oxDNA simulation unit ({OXDNA_LENGTH_UNIT_NM} nm)",
            "has_coordinates": True,
        }


def _lines(text: str) -> list[str]:
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def _parse_topology(text: str, issues: IssueCollector) -> tuple[str, int, list[dict[str, Any]], int] | None:
    lines = _lines(text)
    if not lines:
        issues.add("E_TOP_EMPTY", "Topology file is empty")
        return None
    head = lines[0].split()
    try:
        n, s = int(head[0]), int(head[1])
    except (ValueError, IndexError):
        issues.add(
            "E_TOP_HEADER", "Topology header must start with 'N_nucleotides N_strands'", "topology line 1"
        )
        return None
    if n < 1 or s < 1 or s > n:
        issues.add("E_TOP_HEADER", f"Invalid counts: {n} nucleotides, {s} strands", "topology line 1")
        return None
    if n > issues.limits.max_nucleotides or s > issues.limits.max_strands:
        issues.add(
            "E_LIMIT", f"{n} nucleotides / {s} strands exceeds the configured limits", "topology line 1"
        )
        return None

    nucs: list[dict[str, Any]] = []
    if len(head) >= 3 and head[2] == "5->3":
        if len(lines) - 1 != s:
            issues.add("E_TOP_COUNT", f"Header says {s} strands, found {len(lines) - 1} strand lines")
            return None
        for si, line in enumerate(lines[1:]):
            parts = line.split()
            seq, opts = parts[0].upper(), dict(p.split("=", 1) for p in parts[1:] if "=" in p)
            if not seq or set(seq) - BASES:
                issues.add(
                    "E_TOP_BASE",
                    "Strand sequence must contain only A, C, G, T (custom types unsupported)",
                    f"topology line {si + 2}",
                )
                continue
            circular = opts.get("circular", "false").lower() == "true"
            start = len(nucs)
            for k, base in enumerate(seq):
                i = start + k
                nucs.append(
                    {
                        "strand": si,
                        "base": base,
                        "n5": i - 1 if k else (start + len(seq) - 1 if circular else -1),
                        "n3": i + 1 if k < len(seq) - 1 else (start if circular else -1),
                        "line": si + 2,
                    }
                )
        if len(nucs) != n and not issues.errors:
            issues.add("E_TOP_COUNT", f"Header says {n} nucleotides, sequences contain {len(nucs)}")
        return ("new", n, nucs, s)

    if len(lines) - 1 != n:
        issues.add("E_TOP_COUNT", f"Header says {n} nucleotides, found {len(lines) - 1} nucleotide lines")
        return None
    for i, line in enumerate(lines[1:]):
        parts = line.split()
        loc = f"topology line {i + 2}"
        if len(parts) < 4:
            issues.add("E_TOP_LINE", "Expected 'strand base n3 n5'", loc)
            continue
        try:
            strand, n3, n5 = int(parts[0]), int(parts[2]), int(parts[3])
        except ValueError:
            issues.add("E_TOP_LINE", "Strand and neighbour indices must be integers", loc)
            continue
        base = parts[1].upper()
        if base not in BASES:
            issues.add("E_TOP_BASE", f"Unsupported base {parts[1]!r} (only A, C, G, T)", loc)
        if not 1 <= strand <= s:
            issues.add("E_TOP_STRAND", f"Strand id {strand} outside 1..{s}", loc)
        for name, v in (("3'", n3), ("5'", n5)):
            if v != -1 and not 0 <= v < n:
                issues.add("E_TOP_NEIGHBOUR", f"{name} neighbour {v} outside 0..{n - 1}", loc)
        nucs.append({"strand": strand - 1, "base": base, "n3": n3, "n5": n5, "line": i + 2})
    return ("classic", n, nucs, s)


def _trace_strands(nucs: list[dict[str, Any]], n_strands: int, issues: IssueCollector) -> list[Strand]:
    n = len(nucs)
    for i, nu in enumerate(nucs):
        loc = f"topology line {nu['line']}"
        for here, there, back in (("n3", nu["n3"], "n5"), ("n5", nu["n5"], "n3")):
            if there == -1 or not 0 <= there < n:
                continue
            if nucs[there][back] != i:
                issues.add("E_TOP_LINKAGE", f"Nucleotide {i} {here}->{there} is not reciprocated", loc)
            elif nucs[there]["strand"] != nu["strand"]:
                issues.add(
                    "E_TOP_LINKAGE", f"Nucleotide {i} is bonded to nucleotide {there} of another strand", loc
                )
    if issues.errors:
        return []

    members: list[list[int]] = [[] for _ in range(n_strands)]
    for i, nu in enumerate(nucs):
        members[nu["strand"]].append(i)
    strands: list[Strand] = []
    for si, idx in enumerate(members):
        if not idx:
            issues.add("E_TOP_STRAND", f"Strand {si + 1} has no nucleotides")
            continue
        ends = [i for i in idx if nucs[i]["n5"] == -1]
        circular = not ends
        if len(ends) > 1:
            issues.add("E_TOP_LINKAGE", f"Strand {si + 1} has {len(ends)} 5' ends (it is broken into pieces)")
            continue
        order, seen, cur = [], set(), ends[0] if ends else idx[0]
        while cur != -1 and cur not in seen:
            seen.add(cur)
            order.append(cur)
            cur = nucs[cur]["n3"]
        if len(order) != len(idx):
            issues.add(
                "E_TOP_LINKAGE",
                f"Strand {si + 1}: walking 5'->3' reaches {len(order)} of {len(idx)} nucleotides",
            )
            continue
        strands.append(Strand(si, tuple(order), "".join(nucs[i]["base"] for i in order), circular))
    return strands


def _parse_configuration(
    text: str, n: int, issues: IssueCollector
) -> tuple[list[tuple[float, float, float]], tuple[float, float, float]]:
    lines = _lines(text)
    positions: list[tuple[float, float, float]] = []
    box = (0.0, 0.0, 0.0)
    if len(lines) < 3 or not lines[0].startswith("t") or not lines[1].startswith("b"):
        issues.add(
            "E_CONF_HEADER", "Configuration must start with 't = ...', 'b = Lx Ly Lz', 'E = ...' lines"
        )
        return positions, box
    try:
        box_vals = [float(v) for v in lines[1].split("=", 1)[1].split()[:3]]
        box = (box_vals[0], box_vals[1], box_vals[2])
    except (ValueError, IndexError):
        issues.add("E_CONF_HEADER", "Box line must be 'b = Lx Ly Lz'", "configuration line 2")
    body = lines[3:]
    if len(body) != n:
        issues.add(
            "E_CONF_COUNT", f"Topology has {n} nucleotides but the configuration has {len(body)} lines"
        )
        return positions, box
    tol = issues.limits.unit_vector_tolerance
    for i, line in enumerate(body):
        loc = f"configuration line {i + 4}"
        try:
            vals = [float(v) for v in line.split()]
        except ValueError:
            issues.add("E_CONF_NUMBER", "Non-numeric value", loc)
            continue
        if len(vals) < 9:
            issues.add("E_CONF_LINE", f"Expected at least 9 numbers (r, a1, a3), found {len(vals)}", loc)
            continue
        if not all(math.isfinite(v) for v in vals[:9]):
            issues.add("E_CONF_NUMBER", "Coordinates must be finite numbers", loc)
            continue
        for name, vec in (("a1", vals[3:6]), ("a3", vals[6:9])):
            if abs(math.sqrt(sum(c * c for c in vec)) - 1.0) > tol:
                issues.add("E_CONF_ORIENTATION", f"{name} must be a unit vector", loc)
        positions.append((vals[0], vals[1], vals[2]))
    return positions, box


def parse_oxdna(topology: str, configuration: str, limits: StructureLimits | None = None) -> OxdnaStructure:
    """Validate and parse. Raises StructureError listing every error found."""
    issues = IssueCollector(limits or StructureLimits())
    parsed = _parse_topology(topology, issues)
    issues.raise_if_errors()
    assert parsed is not None
    fmt, n, nucs, s = parsed
    strands = _trace_strands(nucs, s, issues)
    positions, box = _parse_configuration(configuration, n, issues)
    issues.raise_if_errors()

    for st in strands:
        pairs = list(zip(st.nucleotides, st.nucleotides[1:], strict=False))
        if st.circular:
            pairs.append((st.nucleotides[-1], st.nucleotides[0]))
        far = [(a, b) for a, b in pairs if math.dist(positions[a], positions[b]) > BONDED_DISTANCE_WARN]
        if far:
            issues.add(
                "W_BOND_LENGTH",
                f"Strand {st.index + 1}: {len(far)} bonded neighbours are more than "
                f"{BONDED_DISTANCE_WARN} units apart (possibly wrapped across periodic boundaries); "
                "shown as stored",
                severity="warning",
            )
    long = [st for st in strands if len(st.nucleotides) >= STRAIGHT_MIN_LENGTH]
    if long and all(_is_straight([positions[i] for i in st.nucleotides]) for st in long):
        issues.add(
            "W_NONHELICAL_GEOMETRY",
            "Every strand is a straight line: this is not double-helical DNA "
            "geometry and is most likely placeholder data, not a molecular structure",
            severity="warning",
        )
    return OxdnaStructure(fmt, n, tuple(strands), tuple(positions), box, tuple(issues.warnings))


def _is_straight(points: list[tuple[float, float, float]]) -> bool:
    """Max distance of any point from the line through the strand's end points."""
    a, b = points[0], points[-1]
    ab = [b[k] - a[k] for k in range(3)]
    norm = math.sqrt(sum(c * c for c in ab))
    if norm == 0:
        return False
    for p in points[1:-1]:
        ap = [p[k] - a[k] for k in range(3)]
        cross = (ap[1] * ab[2] - ap[2] * ab[1], ap[2] * ab[0] - ap[0] * ab[2], ap[0] * ab[1] - ap[1] * ab[0])
        if math.sqrt(sum(c * c for c in cross)) / norm > STRAIGHT_TOLERANCE:
            return False
    return True


def viewer_geometry(
    structure: OxdnaStructure, roles: dict[int, dict[str, Any]] | None = None
) -> dict[str, Any]:
    """Compact JSON for the viewer. Positions are centred on their centroid (a display translation only)."""
    n = structure.n_nucleotides
    cx = sum(p[0] for p in structure.positions) / n
    cy = sum(p[1] for p in structure.positions) / n
    cz = sum(p[2] for p in structure.positions) / n
    order: list[int] = []
    strands = []
    for st in structure.strands:
        role = (roles or {}).get(st.index, {})
        strands.append(
            {
                "index": st.index,
                "offset": len(order),
                "length": len(st.nucleotides),
                "circular": st.circular,
                "role": role.get("role", "unassigned"),
                "design_strand_id": role.get("design_strand_id"),
                "variant": role.get("variant"),
            }
        )
        order.extend(st.nucleotides)
    flat: list[float] = []
    for i in order:  # strand by strand, 5' -> 3', so consecutive points within a strand are bonded
        x, y, z = structure.positions[i]
        flat.extend((round(x - cx, 4), round(y - cy, 4), round(z - cz, 4)))
    return {
        "kind": "molecular",
        "source": "oxdna",
        "length_unit_nm": OXDNA_LENGTH_UNIT_NM,
        "nucleotides": n,
        "positions": flat,
        "strands": strands,
    }
