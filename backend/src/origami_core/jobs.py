"""Job states and allowed transitions (docs/PLAN.md section 5)."""

from collections import Counter
from collections.abc import Iterable
from enum import StrEnum


class JobType(StrEnum):
    INGEST = "ingest"
    OPTIMIZE = "optimize"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL = frozenset({JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED})
ACTIVE = frozenset({JobStatus.QUEUED, JobStatus.RUNNING})

ALLOWED_TRANSITIONS: dict[JobStatus, frozenset[JobStatus]] = {
    JobStatus.QUEUED: frozenset({JobStatus.RUNNING, JobStatus.CANCELLED, JobStatus.FAILED}),
    JobStatus.RUNNING: frozenset(
        {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.QUEUED}
    ),
    JobStatus.COMPLETED: frozenset(),
    JobStatus.FAILED: frozenset({JobStatus.QUEUED}),
    JobStatus.CANCELLED: frozenset({JobStatus.QUEUED}),
}


def can_transition(src: JobStatus, dst: JobStatus) -> bool:
    return dst in ALLOWED_TRANSITIONS[src]


class DatasetStatus(StrEnum):
    UPLOADED = "uploaded"
    INGESTING = "ingesting"
    READY = "ready"
    READY_WITH_ERRORS = "ready_with_errors"
    FAILED = "failed"


class BatchStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIALLY_FAILED = "partially_failed"
    FAILED = "failed"
    CANCELLED = "cancelled"


def summarize_batch(job_statuses: Iterable[str]) -> tuple[BatchStatus, dict[str, int]]:
    """Derive a batch's status from its jobs' statuses (the jobs are the source of truth)."""
    counts = Counter(job_statuses)
    summary = {s.value: counts.get(s.value, 0) for s in JobStatus}
    total = sum(summary.values())
    if summary["running"] or (summary["queued"] and summary["queued"] < total):
        return BatchStatus.RUNNING, summary
    if summary["queued"]:
        return BatchStatus.QUEUED, summary
    if summary["completed"] == total:
        return BatchStatus.COMPLETED, summary
    if summary["failed"]:
        return (BatchStatus.PARTIALLY_FAILED if summary["completed"] else BatchStatus.FAILED), summary
    return BatchStatus.CANCELLED, summary  # remaining jobs were cancelled by the user
