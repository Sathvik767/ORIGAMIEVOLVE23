from dataclasses import dataclass
from typing import Literal

from origami_core.fitness.base import FitnessError, FitnessResult
from origami_core.models import Design, Strand


@dataclass(frozen=True)
class SyntheticGCBalanceDemo:
    """DEMONSTRATION ONLY: a computational proxy for exercising the GA on synthetic data.

    Score = -(mean absolute deviation of each staple's GC fraction from `gc_target`).
    The 0.5 default target is an arbitrary demonstration value, not a recommendation.
    """

    gc_target: float = 0.5
    name: str = "synthetic_gc_balance_demo"
    version: str = "1.0.0"
    kind: Literal["computational_proxy"] = "computational_proxy"
    description: str = (
        "Demonstration score: negative mean deviation of staple GC fraction from a fixed target. "
        "For synthetic data only."
    )
    limitations: str = (
        "Computational proxy, NOT a scientifically validated measure of DNA folding, yield or stability. "
        "It ignores thermodynamics, secondary structure, kinetics and geometry. Refuses designs not marked "
        "metadata.source == 'synthetic'."
    )
    requires: str = "design metadata.source == 'synthetic'"

    def __post_init__(self) -> None:
        if not 0.0 <= self.gc_target <= 1.0:
            raise FitnessError("gc_target must be between 0 and 1")

    def check_design(self, design: Design) -> None:
        if design.metadata.get("source") != "synthetic":
            raise FitnessError(
                f"{self.name} is a demonstration for synthetic data only; design {design.external_id!r} "
                "is not marked metadata.source == 'synthetic'. "
                "Supply a scientifically justified fitness function."
            )

    def evaluate(self, design: Design, staples: tuple[Strand, ...]) -> FitnessResult:
        if not staples:
            raise FitnessError("No staples to score")
        deviations = [
            abs(sum(b in "GC" for b in s.sequence) / len(s.sequence) - self.gc_target) for s in staples
        ]
        mean_dev = sum(deviations) / len(deviations)
        return FitnessResult(score=-mean_dev, components={"mean_gc_deviation": mean_dev})
