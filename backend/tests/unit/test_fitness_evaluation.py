"""M8: complementarity metric correctness, missing-data handling, GA vs baselines, repeatability."""

import sys
from pathlib import Path

import pytest

from origami_core.fitness import REGISTRY, FitnessError, StapleScaffoldComplementarity, describe, get_fitness
from origami_core.ga import exhaustive_search, optimize, random_search, search_space_size
from origami_core.models import Design, Strand

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from benchmark_optimizer import synthetic_design

SCAFFOLD = "AACCGGTTACGT"  # 12 nt; segment [0..3] = AACC, reverse complement GGTT


def design(staples: tuple[Strand, ...], scaffold: str | None = SCAFFOLD) -> Design:
    return Design(
        external_id="d",
        scaffold=Strand(id="scaf", sequence=scaffold) if scaffold else None,
        staples=staples,
        metadata={"source": "synthetic"},
    )


def test_complementarity_counts_watson_crick_matches_against_the_declared_segment() -> None:
    f = StapleScaffoldComplementarity()
    perfect = Strand(id="a", sequence="GGTT", start=0, end=3)  # revcomp(AACC)
    one_off = Strand(id="b", sequence="GGTA", start=0, end=3)  # last base mismatched
    other = Strand(id="c", sequence="ACGT", start=8, end=11)  # revcomp(ACGT) = ACGT
    d = design((perfect, other))
    assert f.evaluate(d, (perfect,)).score == 1.0
    r = f.evaluate(d, (one_off,))
    assert r.score == 0.75 and r.components == {"mean_complementarity": 0.75, "mismatched_bases": 1}
    assert f.evaluate(d, (perfect, one_off, other)).score == pytest.approx((1 + 0.75 + 1) / 3)
    info = describe(get_fitness(f.name))
    assert info["kind"] == "computational_proxy" and "not a measure of folding" in info["limitations"]
    assert set(REGISTRY) == {"synthetic_gc_balance_demo", "staple_scaffold_complementarity"}


@pytest.mark.parametrize(
    ("staples", "scaffold", "message"),
    [
        ((Strand(id="a", sequence="GGTT", start=0, end=3),), None, "needs a scaffold"),
        ((Strand(id="a", sequence="GGTT"),), SCAFFOLD, "needs start/end"),
        ((Strand(id="a", sequence="GGTT", start=10, end=13),), SCAFFOLD, "outside the scaffold"),
        (
            (Strand(id="a", sequence="GGTTA", start=0, end=3),),
            SCAFFOLD,
            "contiguous binding cannot be assumed",
        ),
        ((Strand(id="a", sequence="GGTT", start=0, end=3, candidates=("GGTTT",)),), SCAFFOLD, "or a variant"),
    ],
)
def test_complementarity_refuses_designs_missing_the_required_data(staples, scaffold, message) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(FitnessError, match=message):
        StapleScaffoldComplementarity().check_design(design(staples, scaffold))


def test_ga_matches_exhaustive_optimum_and_beats_or_ties_equal_budget_random_search() -> None:
    d = synthetic_design(12)  # 2^12 combinations, one single-base variant per staple
    assert search_space_size(d) == 4096
    for name in REGISTRY:
        f = get_fitness(name)
        truth = exhaustive_search(d, f)
        ga = optimize(d, f)  # M2 defaults, seed 42
        assert truth.evaluations == 4096
        assert ga.best_fitness == truth.best_fitness, name
        assert 0 < ga.unique_evaluations <= ga.evaluations
        rnd = random_search(d, f, budget=ga.unique_evaluations, seed=42)
        assert rnd.evaluations == ga.unique_evaluations and rnd.best_fitness <= truth.best_fitness
    # Known analytically: every original staple is a perfect reverse complement of its segment.
    best = exhaustive_search(d, StapleScaffoldComplementarity())
    assert best.best_fitness == 1.0 and best.best_genome == (0,) * 12


def test_baselines_and_ga_are_repeatable_with_a_fixed_seed() -> None:
    d = synthetic_design(10)
    f = StapleScaffoldComplementarity()
    assert random_search(d, f, 200, seed=7) == random_search(d, f, 200, seed=7)
    assert random_search(d, f, 200, seed=7) != random_search(d, f, 200, seed=8)
    a, b = optimize(d, f), optimize(d, f)
    assert a == b and (a.evaluations, a.unique_evaluations) == (b.evaluations, b.unique_evaluations)
    with pytest.raises(ValueError, match="exhaustive limit"):
        exhaustive_search(synthetic_design(10), f, max_combinations=100)
