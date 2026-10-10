"""Per-design optimization jobs (M3). The GA itself lives in origami_core.ga and knows nothing of this."""

import logging
import os
import socket
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument

from origami_api.config import get_settings
from origami_core.fitness import FitnessError, get_fitness
from origami_core.ga import EncodingError, GAParameters, GenerationStats, optimize
from origami_core.jobs import DatasetStatus, JobStatus, JobType
from origami_core.models import Design
from origami_core.storage import StorageBackend
from origami_worker.celery_app import celery_app
from origami_worker.db import get_db, get_storage
from origami_worker.job_state import now, refresh_batch, transition
from origami_worker.task_names import OPTIMIZE_DESIGN, REAP_STALE_JOBS

log = logging.getLogger(__name__)
DESIGN_FIELDS = tuple(Design.model_fields)


def result_key(job_id: ObjectId, attempt: int) -> str:
    return f"results/{job_id}/attempt-{attempt}.json"


def run_optimize(
    db: Any, storage: StorageBackend, job_id: str, attempt: int, *, actor: str, progress_every: int = 5
) -> None:
    """Claim and run one job. A message for an older attempt, or a duplicate delivery, claims nothing."""
    oid = ObjectId(job_id)
    job = transition(
        db,
        oid,
        JobStatus.QUEUED,
        JobStatus.RUNNING,
        actor=actor,
        match={"attempt": attempt},
        fields={"worker_id": actor, "started_at": now(), "heartbeat_at": now(), "error": None},
    )
    if job is None:
        log.info("optimize job %s attempt %s not claimable", job_id, attempt)
        return
    execute_claimed(db, storage, job, actor=actor, progress_every=progress_every)


def execute_claimed(
    db: Any, storage: StorageBackend, job: dict[str, Any], *, actor: str, progress_every: int = 5
) -> None:
    oid, attempt = job["_id"], job["attempt"]
    mine = {"attempt": attempt}  # every write is fenced to this attempt
    stop_reason: str | None = None

    live: list[dict[str, float | int]] = []  # bounded by `generations` (+1)

    def on_progress(stats: GenerationStats) -> bool:
        nonlocal stop_reason
        live.append(stats.model_dump())
        total = job["params"]["generations"]
        if stats.generation % progress_every and stats.generation != total:
            return True
        current = db.jobs.find_one_and_update(
            {"_id": oid, "status": JobStatus.RUNNING.value, **mine},
            {
                "$set": {
                    "heartbeat_at": now(),
                    "updated_at": now(),
                    "progress": {"generation": stats.generation, "total": total, "best_fitness": stats.best},
                    "live_history": live,
                }
            },
            return_document=ReturnDocument.AFTER,
        )
        if current is None:
            stop_reason = "lost"  # requeued by the reaper or otherwise taken over
        elif current.get("cancel_requested"):
            stop_reason = "cancelled"
        return stop_reason is None

    error: dict[str, Any] | None = None
    result = None
    try:
        doc = db.designs.find_one({"_id": job["design_id"]})
        if doc is None:
            raise EncodingError("Design no longer exists")
        design = Design.model_validate({k: doc[k] for k in DESIGN_FIELDS if k in doc})
        result = optimize(design, get_fitness(job["fitness"]), GAParameters(**job["params"]), on_progress)
    except (EncodingError, FitnessError, ValueError) as exc:
        error = {"code": type(exc).__name__, "message": str(exc), "retryable": False}
    except Exception as exc:
        log.exception("optimize job %s crashed", oid)
        error = {"code": "INTERNAL", "message": type(exc).__name__, "retryable": True}

    if stop_reason == "lost":
        return
    if stop_reason == "cancelled":
        transition(
            db,
            oid,
            JobStatus.RUNNING,
            JobStatus.CANCELLED,
            actor=actor,
            match=mine,
            fields={"finished_at": now()},
        )
    elif error is not None or result is None:
        transition(
            db,
            oid,
            JobStatus.RUNNING,
            JobStatus.FAILED,
            actor=actor,
            match=mine,
            fields={"finished_at": now(), "error": error},
            detail=error,
        )
    else:
        # Full result (incl. fitness history, bounded by `generations`) goes to file storage;
        # the job document only keeps a small summary and the reference.
        key = result_key(oid, attempt)
        with storage.open_write(key) as out:
            out.write(result.model_dump_json().encode())
        transition(
            db,
            oid,
            JobStatus.RUNNING,
            JobStatus.COMPLETED,
            actor=actor,
            match=mine,
            fields={
                "finished_at": now(),
                "result": {
                    "result_key": key,
                    "best_fitness": result.best_fitness,
                    "num_genes": result.parameters["num_genes"],
                    "fitness_kind": result.fitness_function["kind"],
                },
            },
        )
    refresh_batch(db, job["batch_id"])


def reap_stale_jobs(
    db: Any,
    dispatch: Callable[..., None],
    *,
    stale_after_s: int,
    max_requeues: int,
    actor: str = "reaper",
) -> int:
    """Recover running jobs whose worker stopped heartbeating. Returns the number of jobs handled."""
    cutoff = now() - timedelta(seconds=stale_after_s)
    handled = 0
    for job in list(db.jobs.find({"status": JobStatus.RUNNING.value, "heartbeat_at": {"$lt": cutoff}})):
        fence = {"attempt": job["attempt"], "heartbeat_at": job["heartbeat_at"]}
        requeues = job.get("stale_requeues", 0)
        if job["type"] == JobType.OPTIMIZE.value and job.get("cancel_requested"):
            done = transition(
                db,
                job["_id"],
                JobStatus.RUNNING,
                JobStatus.CANCELLED,
                actor=actor,
                match=fence,
                fields={"finished_at": now()},
            )
        elif job["type"] == JobType.OPTIMIZE.value and requeues < max_requeues:
            done = transition(
                db,
                job["_id"],
                JobStatus.RUNNING,
                JobStatus.QUEUED,
                actor=actor,
                match=fence,
                fields={
                    "attempt": job["attempt"] + 1,
                    "stale_requeues": requeues + 1,
                    "queued_at": now(),
                    "progress": {},
                },
                detail={"reason": "stale heartbeat"},
            )
            if done is not None:
                dispatch(OPTIMIZE_DESIGN, str(job["_id"]), done["attempt"])
        else:
            error = {"code": "WORKER_LOST", "message": "Worker stopped responding", "retryable": True}
            done = transition(
                db,
                job["_id"],
                JobStatus.RUNNING,
                JobStatus.FAILED,
                actor=actor,
                match=fence,
                fields={"finished_at": now(), "error": error},
                detail=error,
            )
            if done is not None and job["type"] == JobType.INGEST.value:
                db.designs.delete_many({"dataset_id": job["dataset_id"]})
                db.datasets.update_one(
                    {"_id": job["dataset_id"]},
                    {"$set": {"status": DatasetStatus.FAILED.value, "updated_at": now()}},
                )
        if done is not None:
            handled += 1
            if job.get("batch_id"):
                refresh_batch(db, job["batch_id"])
    return handled


def _actor() -> str:
    return f"worker:{socket.gethostname()}:{os.getpid()}"


@celery_app.task(name=OPTIMIZE_DESIGN)
def optimize_design(job_id: str, attempt: int) -> None:
    settings = get_settings()
    run_optimize(
        get_db(),
        get_storage(),
        job_id,
        attempt,
        actor=_actor(),
        progress_every=settings.progress_interval_generations,
    )


@celery_app.task(name=REAP_STALE_JOBS)
def reap_stale_jobs_task() -> int:
    settings = get_settings()

    def dispatch(task: str, *args: Any) -> None:
        celery_app.send_task(task, args=list(args))

    return reap_stale_jobs(
        get_db(),
        dispatch,
        stale_after_s=settings.job_stale_after_s,
        max_requeues=settings.job_max_stale_requeues,
        actor=f"reaper:{_actor()}",
    )
