"""Evaluate the GA against random search and exhaustive enumeration (M8).

For each synthetic problem (one supplied variant per staple, so 2^N combinations) and each registered
objective, this runs:
  * exhaustive enumeration  -> the true optimum (feasible only for small N)
  * the GA with the fixed M2 defaults (population 50, 100 generations, mutation 0.05, crossover 0.8,
    elitism 2, tournament 3), for several seeds (42 is the default)
  * uniform random search with the SAME number of distinct evaluations as the GA run with that seed
and records best fitness, gap to the optimum, distinct evaluations, runtime and reproducibility.

Problems are synthetic (random scaffold, staples = reverse complements, one single-base variant each).
Scores are computational proxies; this measures search quality, not DNA folding.

    .venv\\Scripts\\python scripts\\evaluate_optimizers.py --out ..\\docs\\benchmarks\\optimizer_evaluation
"""

import argparse
import csv
import json
import platform
import sys
import time
from pathlib import Path
from typing import Any

import pygad

from origami_core.fitness import REGISTRY, describe
from origami_core.ga import GAParameters, exhaustive_search, optimize, random_search, search_space_size

sys.path.insert(0, str(Path(__file__).resolve().parent))
from benchmark_optimizer import synthetic_design

FIELDS = [
    "num_genes",
    "search_space",
    "fitness",
    "method",
    "seed",
    "best_fitness",
    "optimum",
    "gap",
    "found_optimum",
    "distinct_evaluations",
    "ga_fitness_requests",
    "runtime_s",
    "reproducible",
]


def timed(fn: Any) -> tuple[Any, float]:
    t0 = time.perf_counter()
    out = fn()
    return out, time.perf_counter() - t0


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sizes", type=int, nargs="+", default=[8, 12, 16])
    p.add_argument("--seeds", type=int, nargs="+", default=[42, 1, 2, 3, 4])
    p.add_argument("--out", type=Path, help="write <out>.csv and <out>.json")
    a = p.parse_args()

    rows: list[dict[str, Any]] = []
    for n in a.sizes:
        design = synthetic_design(n)
        space = search_space_size(design)
        for fname, factory in REGISTRY.items():
            fitness = factory()
            ex, ex_t = timed(lambda f=fitness, d=design: exhaustive_search(d, f))
            opt = ex.best_fitness
            rows.append(
                {
                    "num_genes": n,
                    "search_space": space,
                    "fitness": fname,
                    "method": "exhaustive",
                    "seed": "",
                    "best_fitness": opt,
                    "optimum": opt,
                    "gap": 0.0,
                    "found_optimum": True,
                    "distinct_evaluations": ex.evaluations,
                    "ga_fitness_requests": "",
                    "runtime_s": round(ex_t, 3),
                    "reproducible": True,
                }
            )
            for seed in a.seeds:
                params = GAParameters(seed=seed)
                ga, ga_t = timed(lambda f=fitness, pr=params, d=design: optimize(d, f, pr))
                rep = optimize(design, fitness, params) == ga if seed == a.seeds[0] else ""
                rows.append(
                    {
                        "num_genes": n,
                        "search_space": space,
                        "fitness": fname,
                        "method": "ga",
                        "seed": seed,
                        "best_fitness": ga.best_fitness,
                        "optimum": opt,
                        "gap": opt - ga.best_fitness,
                        "found_optimum": ga.best_fitness == opt,
                        "distinct_evaluations": ga.unique_evaluations,
                        "ga_fitness_requests": ga.evaluations,
                        "runtime_s": round(ga_t, 3),
                        "reproducible": rep,
                    }
                )
                rs, rs_t = timed(
                    lambda f=fitness, b=ga.unique_evaluations, s=seed, d=design: random_search(d, f, b, s)
                )
                rep_r = (
                    random_search(design, fitness, ga.unique_evaluations, seed) == rs
                    if seed == a.seeds[0]
                    else ""
                )
                rows.append(
                    {
                        "num_genes": n,
                        "search_space": space,
                        "fitness": fname,
                        "method": "random",
                        "seed": seed,
                        "best_fitness": rs.best_fitness,
                        "optimum": opt,
                        "gap": opt - rs.best_fitness,
                        "found_optimum": rs.best_fitness == opt,
                        "distinct_evaluations": rs.evaluations,
                        "ga_fitness_requests": "",
                        "runtime_s": round(rs_t, 3),
                        "reproducible": rep_r,
                    }
                )
            print(f"done: {n} genes, {fname}", flush=True)

    print("\nnum_genes | fitness | method | optimum hits | mean gap | mean distinct evals | mean runtime s")
    for n in a.sizes:
        for fname in REGISTRY:
            for method in ("ga", "random", "exhaustive"):
                rs = [
                    r for r in rows if r["num_genes"] == n and r["fitness"] == fname and r["method"] == method
                ]
                hits = sum(bool(r["found_optimum"]) for r in rs)
                print(
                    f"{n} | {fname} | {method} | {hits}/{len(rs)} | "
                    f"{sum(r['gap'] for r in rs) / len(rs):.6f} | "
                    f"{sum(r['distinct_evaluations'] for r in rs) / len(rs):.0f} | "
                    f"{sum(r['runtime_s'] for r in rs) / len(rs):.3f}"
                )
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        with a.out.with_suffix(".csv").open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=FIELDS)
            w.writeheader()
            w.writerows(rows)
        meta = {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "pygad": pygad.__version__,
            "ga_defaults": GAParameters().__dict__ | {"seed": "varied: " + ", ".join(map(str, a.seeds))},
            "objectives": [describe(f()) for f in REGISTRY.values()],
            "note": "Synthetic problems; scores are computational proxies, not folding measurements.",
        }
        a.out.with_suffix(".json").write_text(
            json.dumps({"environment": meta, "results": rows}, indent=2), encoding="utf-8"
        )
        print(f"\nwrote {a.out.with_suffix('.csv')} and {a.out.with_suffix('.json')}")


if __name__ == "__main__":
    main()
