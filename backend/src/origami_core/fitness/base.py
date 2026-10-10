from typing import Literal, Protocol

from pydantic import BaseModel, Field

from origami_core.models import Design, Strand

# There is deliberately no "validated" kind: the system never certifies experimental validity.
FitnessKind = Literal["computational_proxy", "toy_benchmark", "external"]


class FitnessError(ValueError):
    pass


class FitnessResult(BaseModel):
    """Higher is better (the optimizer maximizes)."""

    score: float
    components: dict[str, float] = Field(default_factory=dict)


class FitnessFunction(Protocol):
    @property
    def name(self) -> str: ...
    @property
    def version(self) -> str: ...
    @property
    def kind(self) -> FitnessKind: ...
    @property
    def description(self) -> str: ...
    @property
    def limitations(self) -> str: ...

    def check_design(self, design: Design) -> None:
        """Raise FitnessError if this function must not be used on `design`."""
        ...

    def evaluate(self, design: Design, staples: tuple[Strand, ...]) -> FitnessResult:
        """Score one decoded candidate: `staples` is the design's full staple set with variants applied."""
        ...
