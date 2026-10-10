"""Atomic job state transitions (compare-and-set on the current status). docs/PLAN.md section 5.2."""

from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument

from origami_core.jobs import JobStatus, can_transition, summarize_batch


def now() -> datetime:
    return datetime.now(UTC)


def transition(
    db: Any,
    job_id: ObjectId,
    expected: JobStatus,
    new: JobStatus,
    *,
    actor: str,
    fields: dict[str, Any] | None = None,
    detail: dict[str, Any] | None = None,
    match: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Move a job from `expected` to `new`. Returns the updated job, or None if another actor
    changed it first (the caller lost the race and must not proceed)."""
    if not can_transition(expected, new):
        raise ValueError(f"Illegal job transition {expected} -> {new}")
    at = now()
    doc: dict[str, Any] | None = db.jobs.find_one_and_update(
        {"_id": job_id, "status": expected.value, **(match or {})},
        {"$set": {"status": new.value, "updated_at": at, **(fields or {})}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is not None:
        db.job_events.insert_one(
            {
                "job_id": job_id,
                "at": at,
                "from": expected.value,
                "to": new.value,
                "attempt": doc.get("attempt", 1),
                "actor": actor,
                "detail": detail or {},
            }
        )
    return doc


def heartbeat(db: Any, job_id: ObjectId, progress: dict[str, Any]) -> None:
    db.jobs.update_one(
        {"_id": job_id, "status": JobStatus.RUNNING.value},
        {"$set": {"heartbeat_at": now(), "progress": progress, "updated_at": now()}},
    )


def refresh_batch(db: Any, batch_id: ObjectId) -> None:
    """Recompute a batch's status and counts from its jobs."""
    statuses = [j["status"] for j in db.jobs.find({"batch_id": batch_id}, {"status": 1})]
    status, counts = summarize_batch(statuses)
    fields: dict[str, Any] = {"status": status.value, "counts": counts, "updated_at": now()}
    if not counts["queued"] and not counts["running"]:
        fields["finished_at"] = now()
    db.batches.update_one({"_id": batch_id}, {"$set": fields})
