"""Replaceable fitness functions. See docs/PLAN.md section 0 and 4.4.

Every result is a computational score from a named, versioned function. No function here
predicts DNA folding, yield, or stability.
"""

from collections.abc import Callable
from typing import Any

from origami_core.fitness.base import FitnessError, FitnessFunction, FitnessKind, FitnessResult
from origami_core.fitness.complementarity import StapleScaffoldComplementarity
from origami_core.fitness.demo import SyntheticGCBalanceDemo

# Name -> factory. Jobs reference fitness functions by name so workers can rebuild them; adding an objective
# means implementing FitnessFunction and registering it here. The GA itself never changes.
REGISTRY: dict[str, Callable[[], FitnessFunction]] = {
    SyntheticGCBalanceDemo.name: SyntheticGCBalanceDemo,
    StapleScaffoldComplementarity.name: StapleScaffoldComplementarity,
}
DEFAULT_FITNESS = SyntheticGCBalanceDemo.name


def get_fitness(name: str) -> FitnessFunction:
    if name not in REGISTRY:
        raise FitnessError(f"Unknown fitness function {name!r}")
    return REGISTRY[name]()


def describe(fitness: FitnessFunction) -> dict[str, Any]:
    return {
        "name": fitness.name,
        "version": fitness.version,
        "kind": fitness.kind,
        "description": fitness.description,
        "limitations": fitness.limitations,
        "requires": getattr(fitness, "requires", ""),
    }


__all__ = [
    "DEFAULT_FITNESS",
    "REGISTRY",
    "FitnessError",
    "FitnessFunction",
    "FitnessKind",
    "FitnessResult",
    "StapleScaffoldComplementarity",
    "SyntheticGCBalanceDemo",
    "describe",
    "get_fitness",
]
