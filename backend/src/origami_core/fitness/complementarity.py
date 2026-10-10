from dataclasses import dataclass
from typing import Literal

from origami_core.fitness.base import FitnessError, FitnessResult
from origami_core.models import Design, Strand

COMPLEMENT = {"A": "T", "T": "A", "G": "C", "C": "G"}


@dataclass(frozen=True)
class StapleScaffoldComplementarity:
    """Fraction of Watson-Crick complementary positions between each staple and the scaffold segment it binds.

    Basis: in DNA origami each staple hybridises antiparallel to the scaffold, so its sequence should be the
    reverse complement of the scaffold segment it binds; mismatches remove base pairs from that duplex.
    Score = mean over staples of (matching positions / staple length), in [0, 1]; maximised.
    """

    name: str = "staple_scaffold_complementarity"
    version: str = "1.0.0"
    kind: Literal["computational_proxy"] = "computational_proxy"
    description: str = (
        "Mean fraction of Watson-Crick complementary bases between each staple and the reverse of the "
        "scaffold segment given by its start/end positions."
    )
    limitations: str = (
        "Computational proxy for staple-scaffold base pairing only; not a measure of folding yield, "
        "stability or kinetics. Counts matches, so it ignores nearest-neighbour thermodynamics, mismatch "
        "type and position, salt and temperature. Assumes start..end is one contiguous scaffold segment "
        "(index-aligned, antiparallel); staples spanning crossovers, loops/skips or circular wrap-around "
        "are not supported."
    )
    requires: str = "scaffold sequence; start and end per staple (and variant) with end - start + 1 = length"

    def check_design(self, design: Design) -> None:
        if design.scaffold is None:
            raise FitnessError(
                f"{self.name} needs a scaffold sequence; design {design.external_id!r} has none"
            )
        n = len(design.scaffold.sequence)
        for s in design.staples:
            for seq in (s.sequence, *s.candidates):
                self._segment_check(s, seq, n, design.external_id)

    def _segment_check(self, s: Strand, seq: str, scaffold_len: int, did: str) -> None:
        if s.start is None or s.end is None:
            raise FitnessError(f"{self.name} needs start/end for staple {s.id!r} in design {did!r}")
        if not 0 <= s.start <= s.end < scaffold_len:
            raise FitnessError(f"Staple {s.id!r} start/end lie outside the scaffold in design {did!r}")
        if s.end - s.start + 1 != len(seq):
            raise FitnessError(
                f"Staple {s.id!r} (or a variant) is {len(seq)} nt but start..end spans "
                f"{s.end - s.start + 1}; "
                f"contiguous binding cannot be assumed in design {did!r}"
            )

    def evaluate(self, design: Design, staples: tuple[Strand, ...]) -> FitnessResult:
        if design.scaffold is None or not staples:
            raise FitnessError("Scaffold and staples are required")
        scaffold = design.scaffold.sequence
        fractions = []
        mismatches = 0
        for s in staples:
            self._segment_check(s, s.sequence, len(scaffold), design.external_id)
            assert s.start is not None and s.end is not None
            target = scaffold[s.start : s.end + 1][::-1]  # scaffold read 3'->5' pairs with staple 5'->3'
            matches = sum(COMPLEMENT.get(b) == t for b, t in zip(s.sequence, target, strict=True))
            mismatches += len(s.sequence) - matches
            fractions.append(matches / len(s.sequence))
        score = sum(fractions) / len(fractions)
        return FitnessResult(
            score=score, components={"mean_complementarity": score, "mismatched_bases": mismatches}
        )
