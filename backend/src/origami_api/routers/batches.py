"""Batch optimization (M3): one independent optimize job per design, executed by Celery workers.

Request handlers only create records and enqueue work; the GA never runs in the API process.
"""

import json
import logging
from dataclasses import asdict
from typing import Annotated, Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Header, HTTPException, Request, Response
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from origami_api.db import SCHEMA_VERSION
from origami_api.routers.common import Cursor, Limit, next_cursor, now, parse_cursor, parse_oid
from origami_api.schemas import BatchCreate, BatchOut, FitnessFunctionOut, JobOut, Page, batch_out, job_out
from origami_api.security import CurrentPrincipal
from origami_core.fitness import REGISTRY, FitnessFunction, describe, get_fitness, incompatibility
from origami_core.ga import GAParameters, OptimizationResult, search_space_size
from origami_core.jobs import DatasetStatus, JobStatus, JobType, summarize_batch
from origami_core.models import design_from_doc
from origami_worker.task_names import OPTIMIZE_DESIGN

log = logging.getLogger(__name__)
router = APIRouter(prefix="/batches", tags=["batches"])
jobs_router = APIRouter(prefix="/jobs", tags=["jobs"])

fitness_router = APIRouter(prefix="/fitness-functions", tags=["fitness"])
READY = (DatasetStatus.READY.value, DatasetStatus.READY_WITH_ERRORS.value)
IdempotencyKey = Annotated[str | None, Header(alias="Idempotency-Key", max_length=200)]


async def _event(
    db: Any,
    job_id: ObjectId,
    src: str | None,
    dst: str,
    attempt: int,
    actor: str,
    detail: dict[str, Any] | None = None,
) -> None:
    await db.job_events.insert_one(
        {
            "job_id": job_id,
            "at": now(),
            "from": src,
            "to": dst,
            "attempt": attempt,
            "actor": actor,
            "detail": detail or {},
        }
    )


async def _refresh(db: Any, batch_id: ObjectId) -> dict[str, Any]:
    statuses = [j["status"] async for j in db.jobs.find({"batch_id": batch_id}, {"status": 1})]
    status, counts = summarize_batch(statuses)
    fields: dict[str, Any] = {"status": status.value, "counts": counts, "updated_at": now()}
    if not counts["queued"] and not counts["running"]:
        fields["finished_at"] = now()
    doc: dict[str, Any] = await db.batches.find_one_and_update(
        {"_id": batch_id}, {"$set": fields}, return_document=ReturnDocument.AFTER
    )
    return doc


async def _get_batch(db: Any, batch_id: str) -> dict[str, Any]:
    doc: dict[str, Any] | None = await db.batches.find_one({"_id": parse_oid(batch_id)})
    if doc is None:
        raise HTTPException(404, "Batch not found")
    return doc


async def _get_job(db: Any, job_id: str) -> dict[str, Any]:
    doc: dict[str, Any] | None = await db.jobs.find_one({"_id": parse_oid(job_id)})
    if doc is None:
        raise HTTPException(404, "Job not found")
    return doc


async def _dispatch(request: Request, job: dict[str, Any]) -> None:
    """Enqueue; a broker failure fails the job visibly (retryable) instead of leaving it queued forever."""
    db = request.app.state.db
    try:
        await request.app.state.dispatch(OPTIMIZE_DESIGN, str(job["_id"]), job["attempt"])
    except Exception as exc:
        log.exception("failed to enqueue optimize job %s", job["_id"])
        error = {
            "code": "DISPATCH_FAILED",
            "message": f"Queue unavailable: {type(exc).__name__}",
            "retryable": True,
        }
        failed = await db.jobs.find_one_and_update(
            {"_id": job["_id"], "status": JobStatus.QUEUED.value, "attempt": job["attempt"]},
            {
                "$set": {
                    "status": JobStatus.FAILED.value,
                    "error": error,
                    "finished_at": now(),
                    "updated_at": now(),
                }
            },
        )
        if failed is not None:
            await _event(db, job["_id"], "queued", "failed", job["attempt"], "api", error)


async def _cancel(db: Any, job: dict[str, Any], actor: str) -> bool:
    """Queued -> cancelled now; running -> cancel_requested (the worker stops at its next progress check)."""
    if job["status"] == JobStatus.QUEUED.value:
        done = await db.jobs.find_one_and_update(
            {"_id": job["_id"], "status": JobStatus.QUEUED.value, "attempt": job["attempt"]},
            {"$set": {"status": JobStatus.CANCELLED.value, "finished_at": now(), "updated_at": now()}},
        )
        if done is not None:
            await _event(db, job["_id"], "queued", "cancelled", job["attempt"], actor)
            return True
        job = await db.jobs.find_one({"_id": job["_id"]})  # raced with a worker claim
    if job["status"] == JobStatus.RUNNING.value:
        await db.jobs.update_one(
            {"_id": job["_id"], "status": JobStatus.RUNNING.value},
            {"$set": {"cancel_requested": True, "updated_at": now()}},
        )
        return True
    return False


async def _resolve_designs(
    db: Any, dataset_id: ObjectId, design_ids: list[str] | None, limit: int
) -> list[dict[str, Any]]:
    projection = {"external_id": 1, "candidate_count": 1}
    if design_ids is None:
        designs: list[dict[str, Any]] = (
            await db.designs.find({"dataset_id": dataset_id}, projection)
            .sort("_id", 1)
            .limit(limit + 1)
            .to_list(length=limit + 1)
        )
    else:
        try:
            oids = list(dict.fromkeys(ObjectId(d) for d in design_ids))
        except (InvalidId, TypeError):
            raise HTTPException(422, "design_ids must be valid design ids") from None
        designs = await db.designs.find({"_id": {"$in": oids}, "dataset_id": dataset_id}, projection).to_list(
            length=None
        )
        missing = {str(o) for o in oids} - {str(d["_id"]) for d in designs}
        if missing:
            raise HTTPException(422, f"Designs not found in this dataset: {', '.join(sorted(missing))}")
    if not designs:
        raise HTTPException(422, "Dataset has no designs")
    if len(designs) > limit:
        raise HTTPException(422, f"A batch may contain at most {limit} designs")
    without = [d["external_id"] for d in designs if not d.get("candidate_count")]
    if without:
        raise HTTPException(
            422, f"Designs without staple variants cannot be optimized: {', '.join(without[:20])}"
        )
    return designs


GA_FIELDS = (
    "population_size",
    "generations",
    "mutation_rate",
    "crossover_rate",
    "elitism",
    "tournament_size",
)
MAX_LISTED = 20


def _ga_params(body: BatchCreate, settings: Any) -> dict[str, Any]:
    """GA settings for the batch: request overrides on top of the defaults, validated by GAParameters."""
    overrides = {k: getattr(body, k) for k in GA_FIELDS if getattr(body, k) is not None}
    if overrides.get("population_size", 0) > settings.ga_max_population:
        raise HTTPException(422, f"population_size may be at most {settings.ga_max_population}")
    if overrides.get("generations", 0) > settings.ga_max_generations:
        raise HTTPException(422, f"generations may be at most {settings.ga_max_generations}")
    try:
        return asdict(GAParameters(seed=body.seed, **overrides))
    except ValueError as exc:
        raise HTTPException(422, f"Invalid GA settings: {exc}") from None


async def _check_designs(
    db: Any, designs: list[dict[str, Any]], fitness: FitnessFunction, method: str, max_exhaustive: int
) -> None:
    """Refuse the batch (422, nothing created) if the objective cannot score a design, or an explicit
    exhaustive search would be too large. Same check_design() the worker would otherwise fail on."""
    incompatible: list[str] = []
    too_large: list[str] = []
    async for doc in db.designs.find({"_id": {"$in": [d["_id"] for d in designs]}}):
        design = design_from_doc(doc)
        if (reason := incompatibility(fitness, design)) is not None:
            incompatible.append(f"{design.external_id} ({reason})")
        elif method == "exhaustive" and search_space_size(design) > max_exhaustive:
            too_large.append(design.external_id)
    if incompatible:
        raise HTTPException(
            422,
            f"{len(incompatible)} design(s) cannot be scored by {fitness.name}: "
            + "; ".join(sorted(incompatible)[:MAX_LISTED]),
        )
    if too_large:
        raise HTTPException(
            422,
            f"Exhaustive search is limited to {max_exhaustive} combinations per design; too large: "
            + ", ".join(sorted(too_large)[:MAX_LISTED])
            + ". Use method 'ga' or 'auto'.",
        )


@router.post("", status_code=202, response_model=BatchOut, responses={200: {"model": BatchOut}})
async def create_batch(
    request: Request,
    response: Response,
    principal: CurrentPrincipal,
    body: BatchCreate,
    idempotency_key: IdempotencyKey = None,
) -> BatchOut:
    """Create one queued optimization job per design. Repeating a request with the same
    Idempotency-Key returns the original batch (200) instead of creating another."""
    db = request.app.state.db
    settings = request.app.state.settings
    if idempotency_key and (existing := await db.batches.find_one({"idempotency_key": idempotency_key})):
        response.status_code = 200
        return batch_out(existing)

    dataset = await db.datasets.find_one(
        {"_id": parse_oid(body.dataset_id, not_found="Dataset not found"), "deleted_at": None}
    )
    if dataset is None:
        raise HTTPException(404, "Dataset not found")
    if dataset["status"] not in READY:
        raise HTTPException(409, f"Dataset is {dataset['status']}; only validated datasets can be optimized")
    if body.fitness not in REGISTRY:
        raise HTTPException(422, f"Unknown fitness function {body.fitness!r}; see GET /fitness-functions")
    fitness = get_fitness(body.fitness)
    params = _ga_params(body, settings)
    designs = await _resolve_designs(db, dataset["_id"], body.design_ids, settings.batch_max_designs)
    await _check_designs(db, designs, fitness, body.method, settings.exhaustive_max_combinations)

    at = now()
    batch: dict[str, Any] = {
        "_id": ObjectId(),
        "name": body.name,
        "dataset_id": dataset["_id"],
        "status": "queued",
        "counts": {},
        "total_jobs": len(designs),
        "params": params,
        "method": body.method,
        "fitness": {"name": fitness.name, "version": fitness.version, "kind": fitness.kind},
        "owner": principal.token_id,
        "created_at": at,
        "updated_at": at,
        "finished_at": None,
        "schema_version": SCHEMA_VERSION,
    }
    if idempotency_key:
        batch["idempotency_key"] = idempotency_key
    try:
        await db.batches.insert_one(batch)
    except DuplicateKeyError:  # concurrent request with the same key won
        response.status_code = 200
        return batch_out(await db.batches.find_one({"idempotency_key": idempotency_key}))

    jobs = [
        {
            "_id": ObjectId(),
            "type": JobType.OPTIMIZE.value,
            "batch_id": batch["_id"],
            "dataset_id": dataset["_id"],
            "design_id": d["_id"],
            "external_id": d["external_id"],
            "status": JobStatus.QUEUED.value,
            "attempt": 1,
            "stale_requeues": 0,
            "cancel_requested": False,
            "params": params,
            "method": body.method,
            "fitness": fitness.name,
            "progress": {},
            "error": None,
            "result": None,
            "queued_at": at,
            "started_at": None,
            "finished_at": None,
            "heartbeat_at": None,
            "created_at": at,
            "updated_at": at,
            "schema_version": SCHEMA_VERSION,
        }
        for d in designs
    ]
    await db.jobs.insert_many(jobs)
    await db.job_events.insert_many(
        [
            {
                "job_id": j["_id"],
                "at": at,
                "from": None,
                "to": "queued",
                "attempt": 1,
                "actor": principal.name,
                "detail": {"batch_id": str(batch["_id"])},
            }
            for j in jobs
        ]
    )
    for job in jobs:
        await _dispatch(request, job)
    return batch_out(await _refresh(db, batch["_id"]))


@router.get("", response_model=Page[BatchOut])
async def list_batches(
    request: Request, _: CurrentPrincipal, limit: Limit = 25, cursor: Cursor = None
) -> Page[BatchOut]:
    db = request.app.state.db
    query: dict[str, Any] = {}
    if (after := parse_cursor(cursor)) is not None:
        query["_id"] = {"$lt": after}
    docs = await db.batches.find(query).sort("_id", -1).limit(limit).to_list(length=limit)
    return Page(items=[batch_out(d) for d in docs], next_cursor=next_cursor(docs, limit))


@router.get("/{batch_id}", response_model=BatchOut)
async def get_batch(request: Request, _: CurrentPrincipal, batch_id: str) -> BatchOut:
    db = request.app.state.db
    doc = await _get_batch(db, batch_id)
    return batch_out(await _refresh(db, doc["_id"]))  # recompute so the status is never stale


@router.get("/{batch_id}/jobs", response_model=Page[JobOut])
async def list_batch_jobs(
    request: Request,
    _: CurrentPrincipal,
    batch_id: str,
    status: JobStatus | None = None,
    limit: Limit = 50,
    cursor: Cursor = None,
) -> Page[JobOut]:
    db = request.app.state.db
    batch = await _get_batch(db, batch_id)
    query: dict[str, Any] = {"batch_id": batch["_id"]}
    if status:
        query["status"] = status.value
    if (after := parse_cursor(cursor)) is not None:
        query["_id"] = {"$gt": after}
    docs = await db.jobs.find(query).sort("_id", 1).limit(limit).to_list(length=limit)
    return Page(items=[job_out(d) for d in docs], next_cursor=next_cursor(docs, limit))


@router.post("/{batch_id}/cancel", status_code=202, response_model=BatchOut)
async def cancel_batch(request: Request, principal: CurrentPrincipal, batch_id: str) -> BatchOut:
    db = request.app.state.db
    batch = await _get_batch(db, batch_id)
    active = {"$in": [JobStatus.QUEUED.value, JobStatus.RUNNING.value]}
    async for job in db.jobs.find({"batch_id": batch["_id"], "status": active}):
        await _cancel(db, job, principal.name)
    return batch_out(await _refresh(db, batch["_id"]))


@jobs_router.get("/{job_id}", response_model=JobOut)
async def get_job(request: Request, _: CurrentPrincipal, job_id: str) -> JobOut:
    return job_out(await _get_job(request.app.state.db, job_id))


@jobs_router.post("/{job_id}/cancel", status_code=202, response_model=JobOut)
async def cancel_job(request: Request, principal: CurrentPrincipal, job_id: str) -> JobOut:
    db = request.app.state.db
    job = await _get_job(db, job_id)
    if job["type"] != JobType.OPTIMIZE.value:
        raise HTTPException(409, "Only optimization jobs can be cancelled")
    if not await _cancel(db, job, principal.name):
        raise HTTPException(409, f"Job is already {job['status']}")
    await _refresh(db, job["batch_id"])
    return job_out(await _get_job(db, job_id))


@jobs_router.post("/{job_id}/retry", status_code=202, response_model=JobOut)
async def retry_job(request: Request, principal: CurrentPrincipal, job_id: str) -> JobOut:
    """Re-queue a failed or cancelled job as a new attempt. Messages for older attempts are ignored."""
    db = request.app.state.db
    job = await _get_job(db, job_id)
    if job["type"] != JobType.OPTIMIZE.value:
        raise HTTPException(409, "Use POST /datasets/{id}/ingest to re-run ingestion")
    if job["status"] not in (JobStatus.FAILED.value, JobStatus.CANCELLED.value):
        raise HTTPException(409, f"Only failed or cancelled jobs can be retried (job is {job['status']})")
    queued = await db.jobs.find_one_and_update(
        {"_id": job["_id"], "status": job["status"], "attempt": job["attempt"]},
        {
            "$set": {
                "status": JobStatus.QUEUED.value,
                "attempt": job["attempt"] + 1,
                "cancel_requested": False,
                "error": None,
                "result": None,
                "progress": {},
                "queued_at": now(),
                "started_at": None,
                "finished_at": None,
                "updated_at": now(),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if queued is None:
        raise HTTPException(409, "Job changed concurrently; reload and try again")
    await _event(
        db, job["_id"], job["status"], "queued", queued["attempt"], principal.name, {"reason": "retry"}
    )
    await _dispatch(request, queued)
    await _refresh(db, job["batch_id"])
    return job_out(await _get_job(db, job_id))


@jobs_router.get("/{job_id}/history")
async def get_job_history(request: Request, _: CurrentPrincipal, job_id: str) -> dict[str, Any]:
    """Recorded best and mean population fitness per generation (real GA values only).

    Completed jobs: the full history from the stored result. Running, failed or cancelled jobs: what the
    worker recorded so far. Older jobs may have no history; that is stated, never filled in."""
    job = await _get_job(request.app.state.db, job_id)
    total = (job.get("params") or {}).get("generations")
    out: dict[str, Any] = {
        "job_id": job_id,
        "status": job["status"],
        "total_generations": total,
        "source": "unavailable",
        "history": [],
        "note": None,
    }
    key = (job.get("result") or {}).get("result_key")
    storage = request.app.state.storage
    if job["status"] == JobStatus.COMPLETED.value and key and storage.exists(key):
        with storage.open_read(key) as fh:
            stored = json.loads(fh.read())
        out.update(source="result", history=stored["fitness_history"], note=stored.get("note"))
        if stored.get("method") == "exhaustive":
            out["total_generations"] = None  # exhaustive search runs no generations
    elif job.get("live_history"):
        out.update(source="live", history=job["live_history"])
    else:
        out["note"] = (
            "No generation history was recorded for this job (it has not started, or it ran before "
            "per-generation recording was added)."
        )
    return out


@jobs_router.get("/{job_id}/result", response_model=OptimizationResult)
async def get_job_result(request: Request, _: CurrentPrincipal, job_id: str) -> dict[str, Any]:
    """Full result: best candidate, fitness, selected variants, parameters and fitness history."""
    job = await _get_job(request.app.state.db, job_id)
    key = (job.get("result") or {}).get("result_key")
    storage = request.app.state.storage
    if job["status"] != JobStatus.COMPLETED.value or not key or not storage.exists(key):
        raise HTTPException(404, "Result not available")
    with storage.open_read(key) as fh:
        data: dict[str, Any] = json.loads(fh.read())
    return data


@fitness_router.get("", response_model=list[FitnessFunctionOut])
async def list_fitness_functions(_: CurrentPrincipal) -> list[dict[str, str]]:
    """Available objectives. Every one is a computational proxy; read `limitations` before using it."""
    return [describe(factory()) for factory in REGISTRY.values()]
