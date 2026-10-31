"""Genetic-algorithm optimization over user-supplied staple variants (M2).

The GA only *selects* among sequences already present in the dataset; it never generates
sequences. Fitness comes from a replaceable FitnessFunction (origami_core.fitness).
"""

from origami_core.ga.baselines import SearchResult, exhaustive_search, random_search, search_space_size
from origami_core.ga.encoding import CandidateEncoding, EncodingError
from origami_core.ga.optimizer import (
    AUTO_EXHAUSTIVE_MAX,
    CandidateSelection,
    GAParameters,
    GenerationStats,
    OptimizationMethod,
    OptimizationResult,
    RankedCandidate,
    SelectedVariant,
    exhaustive_optimize,
    optimize,
)

__all__ = [
    "AUTO_EXHAUSTIVE_MAX",
    "CandidateEncoding",
    "CandidateSelection",
    "EncodingError",
    "GAParameters",
    "GenerationStats",
    "OptimizationMethod",
    "OptimizationResult",
    "RankedCandidate",
    "SearchResult",
    "SelectedVariant",
    "exhaustive_optimize",
    "exhaustive_search",
    "optimize",
    "random_search",
    "search_space_size",
]
