"""Reproducible runtime benchmark for the M2 optimizer (synthetic data, demo fitness).

Measures how long `origami_core.ga.optimize` takes for synthetic designs of increasing size with the
fixed M2 defaults (population 50, 100 generations, seed 42), and checks that repeated runs with the
same input, configuration and seed give identical results.

Fitness values come from `synthetic_gc_balance_demo`, a computational proxy. They say nothing about
DNA folding or stability; the benchmark is about speed and determinism only.

Usage (from backend/):
    .venv\\Scripts\\python scripts\\benchmark_optimizer.py              # table to stdout
    .venv\\Scripts\\python scripts\\benchmark_optimizer.py --json out.json
In the API container (same code, Linux):
    Get-Content backend\\scripts\\benchmark_optimizer.py | docker compose exec -T api python - --sizes 3 25
"""

import argparse
import json
import platform
import random
import statistics
import sys
import time
from typing import Any

from origami_core.fitness import SyntheticGCBalanceDemo
from origami_core.ga import GAParameters, optimize
from origami_core.models import Design, Strand

COMPLEMENT = str.maketrans("ACGT", "TGCA")


def synthetic_design(num_genes: int, staple_len: int = 32, seed: int = 7) -> Design:
    """Random scaffold; staples = reverse complements of consecutive segments; one supplied variant each.
    Mirrors scripts/generate_synthetic.py (inlined so this file runs standalone, e.g. piped into Docker)."""
    rng = random.Random(seed)
    scaffold = "".join(rng.choice("ACGT") for _ in range(num_genes * staple_len))
    staples = []
    for i in range(num_genes):
        seq = scaffold[i * staple_len : (i + 1) * staple_len].translate(COMPLEMENT)[::-1]
        pos = rng.randrange(staple_len)
        variant = seq[:pos] + rng.choice([b for b in "ACGT" if b != seq[pos]]) + seq[pos + 1 :]
        staples.append(
            Strand(
                id=f"s{i:04d}",
                sequence=seq,
                helix=i % 6,
                start=i * staple_len,
                end=(i + 1) * staple_len - 1,
                candidates=(variant,),
            )
        )
    return Design(
        external_id=f"bench_{num_genes}",
        scaffold=Strand(id="scaffold", sequence=scaffold),
        staples=tuple(staples),
        metadata={"source": "synthetic"},
    )


def run(num_genes: int, repeats: int, params: GAParameters) -> dict[str, Any]:
    design = synthetic_design(num_genes)
    fitness = SyntheticGCBalanceDemo()
    times, results = [], []
    for _ in range(repeats):
        t0 = time.perf_counter()
        results.append(optimize(design, fitness, params))
        times.append(time.perf_counter() - t0)
    first = results[0]
    return {
        "num_genes": num_genes,
        "staples": len(design.staples),
        "search_space": f"2^{num_genes}",
        "population": params.population_size,
        "generations": params.generations,
        "seed": params.seed,
        "repeats": repeats,
        "runtime_s_median": round(statistics.median(times), 3),
        "runtime_s_min": round(min(times), 3),
        "runtime_s_max": round(max(times), 3),
        "best_fitness": first.best_fitness,
        "best_genome_variants_chosen": sum(first.best_genome),
        "history_points": len(first.fitness_history),
        "reproducible": all(r == first for r in results[1:]),
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--sizes", type=int, nargs="+", default=[3, 25, 100, 250], help="genes (staples with variants)"
    )
    p.add_argument("--repeats", type=int, default=3)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--json", help="also write results to this file")
    a = p.parse_args()

    params = GAParameters(seed=a.seed)  # all other values: fixed M2 defaults
    import pygad

    env = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
        "pygad": pygad.__version__,
        "fitness": "synthetic_gc_balance_demo (computational proxy)",
    }
    rows = [run(n, a.repeats, params) for n in a.sizes]

    print(f"# environment: {json.dumps(env)}")
    cols = [
        "num_genes",
        "population",
        "generations",
        "seed",
        "repeats",
        "runtime_s_median",
        "runtime_s_min",
        "runtime_s_max",
        "best_fitness",
        "best_genome_variants_chosen",
        "reproducible",
    ]
    print(" | ".join(cols))
    for r in rows:
        print(" | ".join(str(r[c]) for c in cols))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump({"environment": env, "results": rows}, fh, indent=2)


if __name__ == "__main__":
    main()
