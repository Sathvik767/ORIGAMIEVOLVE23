import itertools

import pytest

from origami_core.fitness import FitnessError, SyntheticGCBalanceDemo
from origami_core.ga import CandidateEncoding, EncodingError, GAParameters, optimize
from origami_core.models import Design, Strand

# Synthetic: staples s0..s5 each carry user-supplied variants; "fixed" has none.
VARIANTS = {
    "s0": ("AAAAAAAA", "ACACACAC", "GGGGCCCC"),
    "s1": ("TTTTTTTT", "ATATGCGC"),
    "s2": ("GCGCGCGC", "AATTGGCC", "ATATATAT"),
    "s3": ("CCCCAAAA", "CCCCCCCC"),
    "s4": ("ATGCATGC", "AAAATTTT", "GGGGGGGG"),
    "s5": ("TTTTGGGG", "TTTTTTTT"),
}


def design(source: str = "synthetic") -> Design:
    staples = [Strand(id=sid, sequence=opts[0], candidates=opts[1:]) for sid, opts in VARIANTS.items()]
    staples.insert(2, Strand(id="fixed", sequence="ACGTACGT"))
    return Design(external_id="synthetic_1", staples=tuple(staples), metadata={"source": source})


def test_encoding_maps_genes_to_supplied_variants_and_round_trips() -> None:
    enc = CandidateEncoding.from_design(design())
    assert enc.num_genes == 6  # the staple without variants is not a gene
    assert enc.gene_space == [[0, 1, 2], [0, 1], [0, 1, 2], [0, 1], [0, 1, 2], [0, 1]]
    genome = (2, 0, 1, 1, 0, 1)
    staples = enc.decode(genome)
    by_id = {s.id: s.sequence for s in staples}
    assert by_id["s0"] == "GGGGCCCC" and by_id["s1"] == "TTTTTTTT" and by_id["fixed"] == "ACGTACGT"
    slot_sequences = [staples[i].sequence for i in enc.slots]
    assert enc.encode(slot_sequences) == genome


def test_demo_fitness_scores_gc_balance_and_is_labelled_as_proxy() -> None:
    fit = SyntheticGCBalanceDemo()
    d = design()
    balanced = fit.evaluate(d, (Strand(id="a", sequence="GCGCATAT"),))  # GC 0.5
    skewed = fit.evaluate(d, (Strand(id="a", sequence="AAAAAAAA"),))  # GC 0.0
    assert balanced.score == 0.0 and skewed.score == -0.5
    assert skewed.components == {"mean_gc_deviation": 0.5}
    assert fit.kind == "computational_proxy"
    assert "NOT a scientifically validated" in fit.limitations


def test_ga_uses_fixed_parameters_and_finds_the_optimum() -> None:
    d = design()
    fit = SyntheticGCBalanceDemo()
    result = optimize(d, fit)

    enc = CandidateEncoding.from_design(d)
    brute = max(fit.evaluate(d, enc.decode(g)).score for g in itertools.product(*enc.gene_space))
    assert result.best_fitness == pytest.approx(brute)
    assert fit.evaluate(d, enc.decode(result.best_genome)).score == result.best_fitness

    p = result.parameters
    assert (p["population_size"], p["generations"], p["mutation_rate"], p["crossover_rate"]) == (
        50,
        100,
        0.05,
        0.8,
    )
    assert (p["elitism"], p["tournament_size"], p["seed"], p["direction"]) == (2, 3, 42, "maximize")
    assert [h.generation for h in result.fitness_history] == list(range(101))
    bests = [h.best for h in result.fitness_history]
    assert bests == sorted(bests)  # elitism: best never regresses
    assert [v.staple_id for v in result.selected_variants] == list(VARIANTS)
    for v in result.selected_variants:
        assert v.sequence in VARIANTS[v.staple_id]  # never an invented sequence
        assert v.is_original == (v.choice == 0)
    assert result.fitness_function["kind"] == "computational_proxy"


def test_fixed_seed_is_reproducible_and_seed_is_configurable() -> None:
    d, fit = design(), SyntheticGCBalanceDemo()
    first, second = optimize(d, fit), optimize(d, fit)
    assert first == second
    other = optimize(d, fit, GAParameters(seed=7))
    assert other.parameters["seed"] == 7
    assert other.fitness_history != first.fitness_history


def test_invalid_inputs_are_rejected() -> None:
    no_variants = Design(
        external_id="x", staples=(Strand(id="s", sequence="ACGT"),), metadata={"source": "synthetic"}
    )
    with pytest.raises(EncodingError, match="no staple variants"):
        optimize(no_variants, SyntheticGCBalanceDemo())
    with pytest.raises(FitnessError, match="synthetic data only"):
        optimize(design(source="lab"), SyntheticGCBalanceDemo())

    enc = CandidateEncoding.from_design(design())
    with pytest.raises(EncodingError):
        enc.decode((0, 0, 0))  # wrong length
    with pytest.raises(EncodingError):
        enc.decode((3, 0, 0, 0, 0, 0))  # gene out of range
    with pytest.raises(EncodingError, match="not one of its supplied options"):
        enc.encode(["ACGTACGT"] * 6)

    for bad in (
        {"population_size": 1},
        {"generations": 0},
        {"mutation_rate": 1.5},
        {"crossover_rate": -0.1},
        {"elitism": 50},
        {"tournament_size": 51},
        {"seed": -1},
    ):
        with pytest.raises(ValueError):
            GAParameters(**bad)  # type: ignore[arg-type]


def test_final_population_is_ranked_with_real_scores_from_supplied_sequences() -> None:
    d, fit = design(), SyntheticGCBalanceDemo()
    r = optimize(d, fit)
    assert r.final_population_fitness is not None and len(r.final_population_fitness) == 50
    assert max(r.final_population_fitness) == r.best_fitness  # elitism keeps the best in the final population
    cands = r.final_candidates
    assert cands and [c.rank for c in cands] == list(range(1, len(cands) + 1))
    assert [c.fitness for c in cands] == sorted((c.fitness for c in cands), reverse=True)
    assert cands[0].genome == r.best_genome and cands[0].fitness == r.best_fitness
    assert sum(c.occurrences for c in cands) <= 50
    enc = CandidateEncoding.from_design(d)
    for c in cands:
        assert fit.evaluate(d, enc.decode(c.genome)).score == c.fitness  # re-scored independently
        assert all(sel.sequence in VARIANTS[sel.staple_id] for sel in c.selections)


def test_exhaustive_optimize_returns_the_exact_optimum_in_the_ga_result_shape() -> None:
    from origami_core.fitness import incompatibility
    from origami_core.ga import exhaustive_optimize, exhaustive_search, search_space_size
    from origami_worker.tasks.optimize import choose_method

    d, fit = design(), SyntheticGCBalanceDemo()
    result = exhaustive_optimize(d, fit)
    baseline = exhaustive_search(d, fit)
    assert result.method == "exhaustive" and result.fitness_history == [] and result.note
    assert result.best_fitness == baseline.best_fitness and tuple(result.best_genome) == baseline.best_genome
    assert result.best_fitness == optimize(d, fit, GAParameters(seed=42)).best_fitness
    assert result.unique_evaluations == search_space_size(d) == 216
    assert result.best_components["mean_gc_deviation"] == -result.best_fitness
    ranks = result.final_candidates or []
    assert [c.rank for c in ranks] == list(range(1, 11)) and ranks[0].genome == result.best_genome
    assert [v.sequence for v in result.selected_variants] == [s.sequence for s in ranks[0].selections]
    with pytest.raises(ValueError, match="exhaustive limit"):
        exhaustive_optimize(d, fit, max_combinations=100)
    with pytest.raises(FitnessError):
        exhaustive_optimize(design(source="lab"), fit)
    assert incompatibility(fit, design(source="lab")) and incompatibility(fit, d) is None

    assert choose_method("auto", d, 216) == "exhaustive" and choose_method("auto", d, 215) == "ga"
    assert choose_method("ga", d, 10**6) == "ga" and choose_method("exhaustive", d, 1) == "exhaustive"
