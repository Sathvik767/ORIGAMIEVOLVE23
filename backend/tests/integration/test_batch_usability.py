"""Batch usability: objective compatibility at creation, method selection and configurable GA settings."""

from typing import Any

from bson import ObjectId

from .conftest import Harness
from .test_batches_api import EXAMPLE, mark_not_synthetic, ready_dataset

DESIGNS = ("synthetic_00000", "synthetic_00001", "synthetic_00002")


def post_batch(h: Harness, dataset_id: str, **body: Any) -> Any:
    return h.client.post("/api/v1/batches", json={"dataset_id": dataset_id, **body}, headers=h.auth)


def results(h: Harness, batch_id: str) -> dict[str, dict[str, Any]]:
    out = {}
    for job in h.db.jobs.find({"batch_id": ObjectId(batch_id)}):
        assert job["status"] == "completed", job.get("error")
        out[job["external_id"]] = h.client.get(f"/api/v1/jobs/{job['_id']}/result", headers=h.auth).json()
    return out


def test_incompatible_objective_is_refused_at_creation_and_creates_nothing(harness: Harness) -> None:
    lab = ready_dataset(harness, mark_not_synthetic(EXAMPLE, *DESIGNS))
    r = post_batch(harness, lab)  # default objective: the synthetic-only demo
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "3 design(s) cannot be scored by synthetic_gc_balance_demo" in detail
    assert all(d in detail for d in DESIGNS) and "metadata.source" in detail
    assert harness.db.batches.count_documents({}) == 0
    assert harness.db.jobs.count_documents({"type": "optimize"}) == 0
    assert not any(d[0] == "origami.optimize.design" for d in harness.dispatched)

    # One incompatible design refuses the whole batch; selecting only compatible ones works.
    mixed = ready_dataset(harness, mark_not_synthetic(EXAMPLE, "synthetic_00001"))
    r = post_batch(harness, mixed)
    assert (
        r.status_code == 422
        and "1 design(s)" in r.json()["detail"]
        and "synthetic_00001" in r.json()["detail"]
    )
    query = {"dataset_id": ObjectId(mixed), "external_id": {"$ne": "synthetic_00001"}}
    ok_ids = [str(d["_id"]) for d in harness.db.designs.find(query)]
    assert post_batch(harness, mixed, design_ids=ok_ids).status_code == 202

    # An objective that can score them is accepted.
    assert post_batch(harness, lab, fitness="staple_scaffold_complementarity").status_code == 202


def test_compatibility_endpoint_reports_each_design(harness: Harness) -> None:
    mixed = ready_dataset(harness, mark_not_synthetic(EXAMPLE, "synthetic_00001"))
    url = f"/api/v1/datasets/{mixed}/compatibility"
    page = harness.client.get(
        url, params={"fitness": "synthetic_gc_balance_demo"}, headers=harness.auth
    ).json()
    by_id = {c["external_id"]: c for c in page["items"]}
    assert set(by_id) == set(DESIGNS) and page["next_cursor"] is None
    assert (
        by_id["synthetic_00001"]["compatible"] is False and "synthetic" in by_id["synthetic_00001"]["reason"]
    )
    assert by_id["synthetic_00000"] == {
        "design_id": by_id["synthetic_00000"]["design_id"],
        "external_id": "synthetic_00000",
        "compatible": True,
        "reason": None,
    }
    other = harness.client.get(
        url, params={"fitness": "staple_scaffold_complementarity"}, headers=harness.auth
    ).json()
    assert all(c["compatible"] for c in other["items"])
    paged = harness.client.get(
        url, params={"fitness": "synthetic_gc_balance_demo", "limit": 2}, headers=harness.auth
    ).json()
    assert len(paged["items"]) == 2 and paged["next_cursor"]
    bad = harness.client.get(url, params={"fitness": "folding_yield"}, headers=harness.auth)
    assert bad.status_code == 422
    assert harness.client.get(url, params={"fitness": "synthetic_gc_balance_demo"}).status_code == 401


def test_auto_uses_exhaustive_search_for_small_spaces_and_matches_the_ga(harness: Harness) -> None:
    ds = ready_dataset(harness)
    for fitness in ("synthetic_gc_balance_demo", "staple_scaffold_complementarity"):
        runs = {
            m: post_batch(harness, ds, method=m, fitness=fitness, seed=42).json()
            for m in ("auto", "ga", "exhaustive")
        }
        assert {m: b["method"] for m, b in runs.items()} == {
            "auto": "auto",
            "ga": "ga",
            "exhaustive": "exhaustive",
        }
        auto, ga, ex = (results(harness, runs[m]["id"]) for m in ("auto", "ga", "exhaustive"))
        for d in DESIGNS:
            assert auto[d]["method"] == ex[d]["method"] == "exhaustive" and ga[d]["method"] == "ga"
            assert auto[d]["best_fitness"] == ex[d]["best_fitness"] == ga[d]["best_fitness"]
            assert ex[d]["fitness_history"] == [] and "no GA generations" in ex[d]["note"]
            assert ex[d]["parameters"]["search_space_size"] == ex[d]["unique_evaluations"] == 8
            cands = ex[d]["final_candidates"]
            # All 8 combinations are ranked (fewer than the top-10 cap).
            assert len(cands) == 8 and cands[0]["genome"] == ex[d]["best_genome"]
            assert [c["fitness"] for c in cands] == sorted((c["fitness"] for c in cands), reverse=True)
            assert len(ga[d]["fitness_history"]) == 101

    job = harness.db.jobs.find_one({"batch_id": ObjectId(runs["auto"]["id"])})
    assert job["result"]["method"] == "exhaustive" and "best_components" in job["result"]
    hist = harness.client.get(f"/api/v1/jobs/{job['_id']}/history", headers=harness.auth).json()
    assert hist["source"] == "result" and hist["history"] == [] and hist["total_generations"] is None
    assert "no GA generations" in hist["note"]


def test_auto_runs_the_ga_above_the_threshold_and_explicit_exhaustive_is_capped(harness: Harness) -> None:
    ds = ready_dataset(harness)
    harness.settings.exhaustive_auto_max = 4  # examples have 8 combinations
    auto = post_batch(harness, ds).json()
    assert {r["method"] for r in results(harness, auto["id"]).values()} == {"ga"}

    harness.settings.exhaustive_max_combinations = 4
    r = post_batch(harness, ds, method="exhaustive")
    assert r.status_code == 422 and "limited to 4 combinations" in r.json()["detail"]
    r = post_batch(harness, ds, method="sideways")
    assert r.status_code == 422


def test_ga_settings_are_validated_limited_and_recorded(harness: Harness) -> None:
    ds = ready_dataset(harness)
    custom = {
        "population_size": 20,
        "generations": 7,
        "mutation_rate": 0.1,
        "crossover_rate": 0.9,
        "elitism": 1,
        "tournament_size": 4,
    }
    batch = post_batch(harness, ds, method="ga", seed=7, **custom).json()
    assert batch["params"] == {**custom, "seed": 7, "direction": "maximize"}
    jobs = harness.client.get(f"/api/v1/batches/{batch['id']}/jobs", headers=harness.auth).json()["items"]
    for job in jobs:
        assert (
            job["params"] == batch["params"] and job["method"] == "ga" and job["progress"]["generation"] == 7
        )
        result = harness.client.get(f"/api/v1/jobs/{job['id']}/result", headers=harness.auth).json()
        assert len(result["fitness_history"]) == 8 and result["parameters"]["population_size"] == 20

    # Omitted fields keep the defaults.
    defaults = post_batch(harness, ds, generations=5).json()["params"]
    assert (
        defaults["population_size"] == 50
        and defaults["mutation_rate"] == 0.05
        and defaults["generations"] == 5
    )

    before = harness.db.batches.count_documents({})
    for bad, message in [
        ({"elitism": 50}, "elitism"),
        ({"population_size": 10, "tournament_size": 11}, "tournament_size"),
        ({"mutation_rate": 1.5}, "mutation_rate"),
        ({"generations": 0}, "generations"),
        ({"population_size": 501}, "at most 500"),
        ({"generations": 1001}, "at most 1000"),
    ]:
        r = post_batch(harness, ds, **bad)
        assert r.status_code == 422 and message in r.json()["detail"], (bad, r.text)
    assert harness.db.batches.count_documents({}) == before
