from datetime import timedelta
from pathlib import Path
from typing import Any

from bson import ObjectId

from origami_core.jobs import JobStatus
from origami_worker.job_state import now, transition
from origami_worker.tasks.optimize import execute_claimed, reap_stale_jobs

from .conftest import Harness

EXAMPLE = (Path(__file__).resolve().parents[3] / "examples" / "synthetic_designs.csv").read_text()


def ready_dataset(h: Harness, csv: str = EXAMPLE) -> str:
    ds = h.upload(csv).json()["dataset"]
    assert h.client.get(f"/api/v1/datasets/{ds['id']}", headers=h.auth).json()["status"] == "ready"
    return str(ds["id"])


def create_batch(h: Harness, dataset_id: str, **headers: str) -> Any:
    return h.client.post("/api/v1/batches", json={"dataset_id": dataset_id}, headers={**h.auth, **headers})


def jobs_of(h: Harness, batch_id: str) -> list[dict[str, Any]]:
    return list(h.db.jobs.find({"batch_id": ObjectId(batch_id)}).sort("_id", 1))


def test_batch_creation_queues_one_job_per_design_and_is_idempotent(harness: Harness) -> None:
    ds_id = ready_dataset(harness)
    no_variants_id = ready_dataset(harness, "design_id,strand_id,strand_type,sequence\nd1,s1,staple,ACGT\n")
    harness.run_worker = False
    r = create_batch(harness, ds_id, **{"Idempotency-Key": "batch-1"})
    assert r.status_code == 202, r.text
    batch = r.json()
    assert batch["total_jobs"] == 3 and batch["status"] == "queued" and batch["counts"]["queued"] == 3
    assert batch["params"] == {
        "population_size": 50,
        "generations": 100,
        "mutation_rate": 0.05,
        "crossover_rate": 0.8,
        "elitism": 2,
        "tournament_size": 3,
        "seed": 42,
        "direction": "maximize",
    }
    assert batch["fitness"]["kind"] == "computational_proxy"
    # Work is only enqueued (never run in the request handler): one message per job, attempt 1.
    assert sorted(m[1] for m in harness.dispatched) == sorted(
        str(j["_id"]) for j in jobs_of(harness, batch["id"])
    )
    assert {(m[0], m[2]) for m in harness.dispatched} == {("origami.optimize.design", 1)}

    again = create_batch(harness, ds_id, **{"Idempotency-Key": "batch-1"})
    assert again.status_code == 200 and again.json()["id"] == batch["id"]
    assert harness.db.jobs.count_documents({"type": "optimize"}) == 3

    r = create_batch(harness, no_variants_id)
    assert r.status_code == 422 and "without staple variants" in r.json()["detail"]


def test_jobs_run_independently_and_store_results_outside_mongo(harness: Harness) -> None:
    batch = create_batch(harness, ready_dataset(harness)).json()
    detail = harness.client.get(f"/api/v1/batches/{batch['id']}", headers=harness.auth).json()
    assert detail["status"] == "completed" and detail["counts"]["completed"] == 3 and detail["finished_at"]

    jobs = harness.client.get(f"/api/v1/batches/{batch['id']}/jobs", headers=harness.auth).json()["items"]
    assert len({j["result"]["result_key"] for j in jobs}) == 3
    for job in jobs:
        assert job["status"] == "completed" and job["progress"]["generation"] == 100
        result = harness.client.get(f"/api/v1/jobs/{job['id']}/result", headers=harness.auth).json()
        assert result["design_id"] == job["external_id"]
        assert len(result["fitness_history"]) == 101
        assert result["best_fitness"] == job["result"]["best_fitness"]
        design = harness.db.designs.find_one({"_id": ObjectId(job["design_id"])})
        options = {s["id"]: [s["sequence"], *s["candidates"]] for s in design["staples"]}
        assert all(v["sequence"] in options[v["staple_id"]] for v in result["selected_variants"])
    # Fitness history is not stored in MongoDB documents.
    assert all("fitness_history" not in str(j) for j in harness.db.jobs.find())


def test_one_failing_job_does_not_stop_the_batch(harness: Harness) -> None:
    lines = EXAMPLE.splitlines()
    mixed = (
        "\n".join(
            ln[: -len("synthetic")] + "lab" if ln.startswith("synthetic_00001,") else ln for ln in lines
        )
        + "\n"
    )
    batch = create_batch(harness, ready_dataset(harness, mixed)).json()
    jobs = {j["external_id"]: j for j in jobs_of(harness, batch["id"])}
    failed = jobs.pop("synthetic_00001")
    assert failed["status"] == "failed"
    assert failed["error"]["code"] == "FitnessError" and failed["error"]["retryable"] is False
    assert {j["status"] for j in jobs.values()} == {"completed"}
    detail = harness.client.get(f"/api/v1/batches/{batch['id']}", headers=harness.auth).json()
    assert detail["status"] == "partially_failed"
    assert detail["counts"] == {"queued": 0, "running": 0, "completed": 2, "failed": 1, "cancelled": 0}


def test_retries_are_new_attempts_and_stale_or_duplicate_messages_are_ignored(harness: Harness) -> None:
    ds_id = ready_dataset(harness)
    harness.run_worker = False
    batch = create_batch(harness, ds_id).json()
    first, second, _ = jobs_of(harness, batch["id"])
    assert harness.client.post(f"/api/v1/jobs/{first['_id']}/cancel", headers=harness.auth).status_code == 202

    old_messages = list(harness.dispatched)
    harness.run_pending()
    harness.dispatched = list(old_messages)
    harness.run_pending()  # duplicate delivery: nothing claimable
    assert harness.db.jobs.find_one({"_id": first["_id"]})["status"] == "cancelled"
    assert harness.db.job_events.count_documents({"job_id": second["_id"]}) == 3  # queued, running, completed

    r = harness.client.post(f"/api/v1/jobs/{first['_id']}/retry", headers=harness.auth)
    assert r.status_code == 202 and r.json()["attempt"] == 2 and r.json()["status"] == "queued"
    harness.dispatched = [old_messages[0], *harness.dispatched]  # stale attempt-1 message arrives too
    harness.run_pending()
    retried = harness.db.jobs.find_one({"_id": first["_id"]})
    assert retried["status"] == "completed" and retried["result"]["result_key"].endswith("attempt-2.json")
    completed_retry = harness.client.post(f"/api/v1/jobs/{second['_id']}/retry", headers=harness.auth)
    assert completed_retry.status_code == 409

    # Stale recovery: a running job whose worker stopped heartbeating is requeued as a new attempt.
    harness.db.jobs.update_one(
        {"_id": second["_id"]}, {"$set": {"status": "running", "heartbeat_at": now() - timedelta(hours=1)}}
    )
    requeued: list[tuple[Any, ...]] = []
    assert reap_stale_jobs(harness.db, lambda *a: requeued.append(a), stale_after_s=60, max_requeues=1) == 1
    assert requeued == [("origami.optimize.design", str(second["_id"]), 2)]
    harness.db.jobs.update_one(
        {"_id": second["_id"]}, {"$set": {"status": "running", "heartbeat_at": now() - timedelta(hours=1)}}
    )
    reap_stale_jobs(harness.db, lambda *a: requeued.append(a), stale_after_s=60, max_requeues=1)
    lost = harness.db.jobs.find_one({"_id": second["_id"]})
    assert lost["status"] == "failed" and lost["error"]["code"] == "WORKER_LOST"  # requeue budget used up


def test_cancellation_of_queued_running_and_whole_batches(harness: Harness) -> None:
    ds_id = ready_dataset(harness)
    harness.run_worker = False
    batch = create_batch(harness, ds_id).json()
    queued_job, running_job, _ = jobs_of(harness, batch["id"])

    r = harness.client.post(f"/api/v1/jobs/{queued_job['_id']}/cancel", headers=harness.auth)
    assert r.status_code == 202 and r.json()["status"] == "cancelled"
    assert (
        harness.client.post(f"/api/v1/jobs/{queued_job['_id']}/cancel", headers=harness.auth).status_code
        == 409
    )

    claimed = transition(
        harness.db,
        running_job["_id"],
        JobStatus.QUEUED,
        JobStatus.RUNNING,
        actor="w",
        match={"attempt": 1},
        fields={"heartbeat_at": now()},
    )
    assert claimed is not None
    r = harness.client.post(f"/api/v1/jobs/{running_job['_id']}/cancel", headers=harness.auth)
    assert r.status_code == 202 and r.json()["status"] == "running" and r.json()["cancel_requested"]
    execute_claimed(harness.db, harness.storage, claimed, actor="w")  # worker sees the request and stops
    events = [e["to"] for e in harness.db.job_events.find({"job_id": running_job["_id"]}).sort("at", 1)]
    assert events == ["queued", "running", "cancelled"]

    harness.run_pending()  # the third job still completes
    detail = harness.client.get(f"/api/v1/batches/{batch['id']}", headers=harness.auth).json()
    assert detail["counts"] == {"queued": 0, "running": 0, "completed": 1, "failed": 0, "cancelled": 2}
    assert detail["status"] == "cancelled"

    other = create_batch(harness, ds_id).json()
    r = harness.client.post(f"/api/v1/batches/{other['id']}/cancel", headers=harness.auth)
    assert r.status_code == 202 and r.json()["status"] == "cancelled" and r.json()["counts"]["cancelled"] == 3


def test_objective_is_selectable_listed_and_recorded_with_its_limitations(harness: Harness) -> None:
    assert harness.client.get("/api/v1/fitness-functions").status_code == 401
    listed = harness.client.get("/api/v1/fitness-functions", headers=harness.auth).json()
    by_name = {f["name"]: f for f in listed}
    assert set(by_name) == {"synthetic_gc_balance_demo", "staple_scaffold_complementarity"}
    assert all(f["kind"] == "computational_proxy" and f["limitations"] for f in listed)

    ds_id = ready_dataset(harness)
    bad = harness.client.post(
        "/api/v1/batches", json={"dataset_id": ds_id, "fitness": "folding_yield"}, headers=harness.auth
    )
    assert bad.status_code == 422 and "Unknown fitness function" in bad.json()["detail"]

    batch = harness.client.post(
        "/api/v1/batches",
        json={"dataset_id": ds_id, "fitness": "staple_scaffold_complementarity"},
        headers=harness.auth,
    ).json()
    assert batch["fitness"]["name"] == "staple_scaffold_complementarity"
    for job in jobs_of(harness, batch["id"]):
        assert job["status"] == "completed" and job["fitness"] == "staple_scaffold_complementarity"
        result = harness.client.get(f"/api/v1/jobs/{job['_id']}/result", headers=harness.auth).json()
        assert (
            result["fitness_function"]["limitations"]
            == by_name["staple_scaffold_complementarity"]["limitations"]
        )
        assert result["best_fitness"] == 1.0  # synthetic originals are perfect reverse complements
        assert result["unique_evaluations"] > 0


def test_generation_history_is_persisted_for_completed_partial_for_cancelled_and_never_invented(
    harness: Harness,
) -> None:
    ds_id = ready_dataset(harness)
    done = create_batch(harness, ds_id).json()
    job = jobs_of(harness, done["id"])[0]
    h = harness.client.get(f"/api/v1/jobs/{job['_id']}/history", headers=harness.auth).json()
    assert h["source"] == "result" and h["status"] == "completed" and h["total_generations"] == 100
    assert [g["generation"] for g in h["history"]] == list(range(101))
    result = harness.client.get(f"/api/v1/jobs/{job['_id']}/result", headers=harness.auth).json()
    assert h["history"] == result["fitness_history"]  # same stored values after any refresh
    assert result["final_candidates"][0]["genome"] == result["best_genome"]
    assert len(result["final_population_fitness"]) == 50

    harness.run_worker = False
    other = create_batch(harness, ds_id).json()
    queued, running, _ = jobs_of(harness, other["id"])
    h = harness.client.get(f"/api/v1/jobs/{queued['_id']}/history", headers=harness.auth).json()
    assert h["source"] == "unavailable" and h["history"] == [] and "No generation history" in h["note"]

    claimed = transition(
        harness.db,
        running["_id"],
        JobStatus.QUEUED,
        JobStatus.RUNNING,
        actor="w",
        match={"attempt": 1},
        fields={"heartbeat_at": now()},
    )
    harness.client.post(f"/api/v1/jobs/{running['_id']}/cancel", headers=harness.auth)
    execute_claimed(harness.db, harness.storage, claimed, actor="w")  # stops at the first progress write
    h = harness.client.get(f"/api/v1/jobs/{running['_id']}/history", headers=harness.auth).json()
    assert h["status"] == "cancelled" and h["source"] == "live"
    gens = [g["generation"] for g in h["history"]]
    assert gens == list(range(len(gens))) and 0 < len(gens) < 101  # real partial history from generation 0
    assert all(set(g) == {"generation", "best", "mean"} for g in h["history"])

    tools = harness.client.get("/api/v1/structures/tools", headers=harness.auth).json()
    assert tools["oxdna"]["available"] is False and "ORIGAMI_OXDNA_BIN" in tools["oxdna"]["message"]
