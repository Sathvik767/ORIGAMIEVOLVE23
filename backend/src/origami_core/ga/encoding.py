"""Chromosome <-> design mapping.

One gene per staple that has at least one user-supplied candidate ("slot"). Gene value
0 keeps the staple's original sequence; value k selects ``candidates[k - 1]``. Staples
without candidates are fixed and not part of the chromosome.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from origami_core.models import Design, Strand


class EncodingError(ValueError):
    pass


@dataclass(frozen=True)
class CandidateEncoding:
    design: Design
    slots: tuple[int, ...]  # indices into design.staples

    @classmethod
    def from_design(cls, design: Design) -> "CandidateEncoding":
        slots = tuple(i for i, s in enumerate(design.staples) if s.candidates)
        if not slots:
            raise EncodingError(
                f"Design {design.external_id!r} has no staple variants; nothing to optimize "
                "(variants must be supplied in the dataset, they are never generated)"
            )
        return cls(design, slots)

    @property
    def num_genes(self) -> int:
        return len(self.slots)

    def options(self, slot: int) -> tuple[str, ...]:
        staple = self.design.staples[self.slots[slot]]
        return (staple.sequence, *staple.candidates)

    @property
    def gene_space(self) -> list[list[int]]:
        return [list(range(len(self.options(g)))) for g in range(self.num_genes)]

    def validate(self, genome: Sequence[int]) -> tuple[int, ...]:
        if len(genome) != self.num_genes:
            raise EncodingError(f"Genome has {len(genome)} genes, expected {self.num_genes}")
        values = tuple(int(v) for v in genome)
        for g, (raw, value) in enumerate(zip(genome, values, strict=True)):
            if raw != value or not 0 <= value < len(self.options(g)):
                raise EncodingError(f"Gene {g} = {raw!r} is outside 0..{len(self.options(g)) - 1}")
        return values

    def decode(self, genome: Sequence[int]) -> tuple[Strand, ...]:
        """Return the full staple set with each slot's selected sequence substituted."""
        values = self.validate(genome)
        staples = list(self.design.staples)
        for g, value in enumerate(values):
            idx = self.slots[g]
            staples[idx] = staples[idx].model_copy(update={"sequence": self.options(g)[value]})
        return tuple(staples)

    def encode(self, sequences: Sequence[str]) -> tuple[int, ...]:
        """Inverse of decode for the slot sequences. Rejects any sequence not supplied in the dataset."""
        if len(sequences) != self.num_genes:
            raise EncodingError(f"Got {len(sequences)} sequences, expected {self.num_genes}")
        genome = []
        for g, seq in enumerate(sequences):
            try:
                genome.append(self.options(g).index(seq))
            except ValueError:
                staple_id = self.design.staples[self.slots[g]].id
                raise EncodingError(
                    f"Sequence for staple {staple_id!r} is not one of its supplied options"
                ) from None
        return tuple(genome)
