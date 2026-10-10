"""Verified mapping between a dataset design and the strands of an imported structure.

A design strand is mapped to a structure strand only when their sequences are identical (5'->3',
exact match, case-insensitive) and the match is unique. Nothing is inferred from position or length.
Optimized staple variants are then reported against the mapped structural strand; the structure
itself still contains the original sequence (no remodelling is done).
"""

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from origami_core.models import Design
from origami_core.structure.oxdna import OxdnaStructure


@dataclass
class StapleMapping:
    scaffold_strand: int | None = None
    staples: dict[str, int] = field(default_factory=dict)  # design staple id -> structure strand index
    unmatched: list[str] = field(default_factory=list)
    ambiguous: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def status(self) -> str:
        if self.scaffold_strand is not None and self.staples and not self.unmatched and not self.ambiguous:
            return "verified"
        return "partial" if self.staples or self.scaffold_strand is not None else "unmatched"

    def roles(self, variants: dict[str, dict[str, Any]] | None = None) -> dict[int, dict[str, Any]]:
        """Per structure strand: role and (when an optimization result is given) variant compatibility."""
        out: dict[int, dict[str, Any]] = {}
        if self.scaffold_strand is not None:
            out[self.scaffold_strand] = {"role": "scaffold", "design_strand_id": None}
        for sid, idx in self.staples.items():
            role: dict[str, Any] = {"role": "staple", "design_strand_id": sid}
            if variants and sid in variants:
                role["variant"] = variants[sid]
            out[idx] = role
        return out

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "scaffold_strand": self.scaffold_strand,
            "staples": self.staples,
            "unmatched": self.unmatched,
            "ambiguous": self.ambiguous,
            "notes": self.notes,
        }


def map_design(design: Design, structure: OxdnaStructure) -> StapleMapping:
    by_seq: dict[str, list[int]] = defaultdict(list)
    for st in structure.strands:
        by_seq[st.sequence.upper()].append(st.index)
    m = StapleMapping()

    if design.scaffold is None:
        m.notes.append("Design has no scaffold; scaffold not mapped")
    else:
        hits = by_seq.get(design.scaffold.sequence.upper(), [])
        if len(hits) == 1:
            m.scaffold_strand = hits[0]
        elif hits:
            m.ambiguous.append(design.scaffold.id)
        else:
            m.unmatched.append(design.scaffold.id)
            m.notes.append(
                "Scaffold sequence not found exactly (circular scaffolds stored with a different start "
                "position are not matched)"
            )
    for staple in design.staples:
        hits = [h for h in by_seq.get(staple.sequence.upper(), []) if h != m.scaffold_strand]
        if len(hits) == 1:
            m.staples[staple.id] = hits[0]
        elif hits:
            m.ambiguous.append(staple.id)
        else:
            m.unmatched.append(staple.id)
    return m


def variant_compatibility(
    design: Design, mapping: StapleMapping, selected: list[dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """For each optimized staple: is it mapped, and does the chosen variant fit the modelled strand length?"""
    lengths = {s.id: len(s.sequence) for s in design.staples}
    out: dict[str, dict[str, Any]] = {}
    for v in selected:
        sid = v["staple_id"]
        same_len = len(v["sequence"]) == lengths.get(sid)
        out[sid] = {
            "choice": v["choice"],
            "is_original": v["is_original"],
            "mapped": sid in mapping.staples,
            "length_compatible": same_len,
            # The structure shows the original sequence; a variant is only an annotation on that strand.
            "structure_shows_variant_sequence": bool(v["is_original"]),
        }
    return out
