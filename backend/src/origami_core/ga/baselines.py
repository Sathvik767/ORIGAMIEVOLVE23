"""Baselines for evaluating the GA: uniform random search and exhaustive enumeration.

Both use the same CandidateEncoding and FitnessFunction as the GA, so results are directly comparable.
"""

import itertools
import math
import random
from dataclasses import dataclass

from origami_core.fitness import FitnessFunction
from origami_core.ga.encoding import CandidateEncoding
from origami_core.models import Design


@dataclass(frozen=True)
class SearchResult:
    method: str
    best_genome: tuple[int, ...]
    best_fitness: float
    evaluations: int  # distinct genomes scored


def search_space_size(design: Design) -> int:
    return math.prod(len(g) for g in CandidateEncoding.from_design(design).gene_space)


def _pick(
    best: SearchResult | None, method: str, genome: tuple[int, ...], score: float, n: int
) -> SearchResult:
    # Same tie-break as the GA: higher score, then the lexicographically smallest genome.
    if (
        best is None
        or score > best.best_fitness
        or (score == best.best_fitness and genome < best.best_genome)
    ):
        return SearchResult(method, genome, score, n)
    return SearchResult(method, best.best_genome, best.best_fitness, n)


def exhaustive_search(
    design: Design, fitness: FitnessFunction, max_combinations: int = 2**20
) -> SearchResult:
    fitness.check_design(design)
    enc = CandidateEncoding.from_design(design)
    size = search_space_size(design)
    if size > max_combinations:
        raise ValueError(f"Search space has {size} combinations; exhaustive limit is {max_combinations}")
    best: SearchResult | None = None
    for n, genome in enumerate(itertools.product(*enc.gene_space), start=1):
        best = _pick(best, "exhaustive", genome, fitness.evaluate(design, enc.decode(genome)).score, n)
    assert best is not None
    return best


def random_search(design: Design, fitness: FitnessFunction, budget: int, seed: int) -> SearchResult:
    """Score `budget` distinct uniformly random genomes (or the whole space if it is smaller)."""
    fitness.check_design(design)
    enc = CandidateEncoding.from_design(design)
    budget = min(budget, search_space_size(design))
    rng = random.Random(seed)  # noqa: S311 - seeded for reproducible search, not security
    seen: set[tuple[int, ...]] = set()
    best: SearchResult | None = None
    while len(seen) < budget:
        genome = tuple(rng.randrange(len(opts)) for opts in enc.gene_space)
        if genome in seen:
            continue
        seen.add(genome)
        best = _pick(best, "random", genome, fitness.evaluate(design, enc.decode(genome)).score, len(seen))
    assert best is not None
    return best
