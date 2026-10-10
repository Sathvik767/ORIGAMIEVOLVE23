"""PyGAD-backed optimizer for a single design (no persistence, queueing or batching in M2)."""

import math
from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Any, Literal

import numpy as np
import pygad
from pydantic import BaseModel

from origami_core.fitness import FitnessError, FitnessFunction, FitnessResult
from origami_core.ga.encoding import CandidateEncoding
from origami_core.models import Design


@dataclass(frozen=True)
class GAParameters:
    """Fixed M2 defaults (docs/PLAN.md section 10). Only `seed` is meant to be user-configurable."""

    population_size: int = 50
    generations: int = 100
    mutation_rate: float = 0.05
    crossover_rate: float = 0.8
    elitism: int = 2
    tournament_size: int = 3
    seed: int = 42
    direction: Literal["maximize"] = "maximize"

    def __post_init__(self) -> None:
        if self.population_size < 2:
            raise ValueError("population_size must be >= 2")
        if self.generations < 1:
            raise ValueError("generations must be >= 1")
        for name in ("mutation_rate", "crossover_rate"):
            if not 0.0 <= getattr(self, name) <= 1.0:
                raise ValueError(f"{name} must be between 0 and 1")
        if not 0 <= self.elitism < self.population_size:
            raise ValueError("elitism must be >= 0 and < population_size")
        if not 1 <= self.tournament_size <= self.population_size:
            raise ValueError("tournament_size must be between 1 and population_size")
        if self.seed < 0:
            raise ValueError("seed must be >= 0")
        if self.direction != "maximize":
            raise ValueError("only maximization is supported")


class GenerationStats(BaseModel):
    generation: int
    best: float
    mean: float


class SelectedVariant(BaseModel):
    staple_id: str
    choice: int  # 0 = original sequence, k = candidates[k - 1]
    is_original: bool
    sequence: str


class CandidateSelection(BaseModel):
    staple_id: str
    choice: int  # 0 = original sequence, k = candidates[k - 1]
    is_original: bool
    sequence: str


class RankedCandidate(BaseModel):
    """A distinct genome present in the FINAL population, scored by the run's fitness function."""

    rank: int
    genome: list[int]
    fitness: float
    components: dict[str, float]
    occurrences: int  # copies of this genome in the final population
    selections: list[CandidateSelection]


TOP_CANDIDATES = 10


class OptimizationResult(BaseModel):
    design_id: str
    best_genome: list[int]
    best_fitness: float
    best_components: dict[str, float]
    fitness_history: list[GenerationStats]  # generation 0 = initial population
    stopped_early: bool = False  # on_progress asked to stop (e.g. cancellation)
    evaluations: int = 0  # fitness requests made by the GA (incl. repeats of the same genome)
    unique_evaluations: int = 0  # distinct genomes actually scored (repeats are cached)
    # Final population (absent in results produced before this field existed).
    final_population_fitness: list[float] | None = None  # one value per individual
    final_candidates: list[RankedCandidate] | None = None  # top distinct genomes, best first
    selected_variants: list[SelectedVariant]
    parameters: dict[str, Any]
    fitness_function: dict[str, str]


def optimize(
    design: Design,
    fitness: FitnessFunction,
    params: GAParameters | None = None,
    on_progress: Callable[[GenerationStats], bool] | None = None,
) -> OptimizationResult:
    """Run the GA. `on_progress` is called after each generation; returning False stops the run early."""
    params = params or GAParameters()
    fitness.check_design(design)
    encoding = CandidateEncoding.from_design(design)
    cache: dict[tuple[int, ...], FitnessResult] = {}

    def score(genome: tuple[int, ...]) -> FitnessResult:
        if genome not in cache:
            result = fitness.evaluate(design, encoding.decode(genome))
            if not math.isfinite(result.score):
                raise FitnessError(f"{fitness.name} returned a non-finite score: {result.score}")
            cache[genome] = result
        return cache[genome]

    requests = 0

    def fitness_func(_ga: Any, solution: Any, _idx: Any) -> float:
        nonlocal requests
        requests += 1
        return score(tuple(int(v) for v in solution)).score

    history: list[GenerationStats] = []

    def record(population_fitness: Any, generation: int) -> None:
        values = np.asarray(population_fitness, dtype=float)
        history.append(
            GenerationStats(generation=generation, best=float(values.max()), mean=float(values.mean()))
        )

    def on_start(ga: Any) -> None:
        record(ga.cal_pop_fitness(), 0)
        if on_progress is not None:
            on_progress(history[-1])  # initial population; stopping only takes effect from generation 1

    stopped = False

    def on_generation(ga: Any) -> str | None:
        nonlocal stopped
        record(ga.last_generation_fitness, ga.generations_completed)
        if on_progress is not None and not on_progress(history[-1]):
            stopped = True
            return "stop"  # PyGAD convention for ending the run
        return None

    ga = pygad.GA(
        num_generations=params.generations,
        sol_per_pop=params.population_size,
        # Required by PyGAD; not a tuning choice: every tournament-selected parent mates.
        num_parents_mating=params.population_size,
        num_genes=encoding.num_genes,
        gene_space=encoding.gene_space,
        gene_type=int,
        fitness_func=fitness_func,
        parent_selection_type="tournament",
        K_tournament=params.tournament_size,
        crossover_type="single_point" if encoding.num_genes > 1 else None,
        crossover_probability=params.crossover_rate,
        mutation_type="random",
        mutation_probability=params.mutation_rate,
        mutation_by_replacement=True,
        keep_elitism=params.elitism,
        random_seed=params.seed,
        on_start=on_start,
        on_generation=on_generation,
        suppress_warnings=True,
    )
    ga.run()
    # The best ever seen is retained by elitism; take it from the cache so ties resolve deterministically.
    best_genome, best = max(cache.items(), key=lambda kv: (kv[1].score, tuple(-g for g in kv[0])))
    decoded = encoding.decode(best_genome)

    final = [tuple(int(v) for v in row) for row in ga.population]
    final_scores = [score(g).score for g in final]  # same deterministic fitness, cached
    counts: dict[tuple[int, ...], int] = {}
    for g in final:
        counts[g] = counts.get(g, 0) + 1
    ranked = sorted(counts, key=lambda g: (-score(g).score, g))[:TOP_CANDIDATES]

    def selections(genome: tuple[int, ...]) -> list[CandidateSelection]:
        return [
            CandidateSelection(
                staple_id=design.staples[idx].id,
                choice=genome[k],
                is_original=genome[k] == 0,
                sequence=encoding.options(k)[genome[k]],
            )
            for k, idx in enumerate(encoding.slots)
        ]

    candidates = [
        RankedCandidate(
            rank=i + 1,
            genome=list(g),
            fitness=score(g).score,
            components=score(g).components,
            occurrences=counts[g],
            selections=selections(g),
        )
        for i, g in enumerate(ranked)
    ]

    return OptimizationResult(
        design_id=design.external_id,
        best_genome=list(best_genome),
        best_fitness=best.score,
        best_components=best.components,
        fitness_history=history,
        stopped_early=stopped,
        evaluations=requests,
        unique_evaluations=len(cache),
        final_population_fitness=final_scores,
        final_candidates=candidates,
        selected_variants=[
            SelectedVariant(
                staple_id=decoded[idx].id,
                choice=best_genome[g],
                is_original=best_genome[g] == 0,
                sequence=decoded[idx].sequence,
            )
            for g, idx in enumerate(encoding.slots)
        ],
        parameters={
            **asdict(params),
            "num_parents_mating": params.population_size,
            "crossover_type": "single_point" if encoding.num_genes > 1 else "none (single gene)",
            "mutation_type": "random (replacement from supplied options)",
            "num_genes": encoding.num_genes,
            "engine": f"pygad {pygad.__version__}",
        },
        fitness_function={
            "name": fitness.name,
            "version": fitness.version,
            "kind": fitness.kind,
            "description": fitness.description,
            "limitations": fitness.limitations,
        },
    )
