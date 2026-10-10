"""Dataset ingestion: stream the stored upload through the validating readers into MongoDB."""

import json
import logging
import os
import socket
from typing import Any

from bson import ObjectId

from origami_api.config import get_settings
from origami_api.db import SCHEMA_VERSION
from origami_core.ingest import IngestAborted, IngestLimits, Issue, new_report, parse_designs
from origami_core.jobs import DatasetStatus, JobStatus
from origami_core.models import Design, DesignFormat
from origami_core.storage import StorageBackend
from origami_worker.celery_app import celery_app
from origami_worker.db import get_db, get_storage
from origami_worker.job_state import heartbeat, now, transition
from origami_worker.task_names import INGEST_DATASET

log = logging.getLogger(__name__)


def design_document(design: Design, dataset_id: ObjectId) -> dict[str, Any]:
    body = design.model_dump(mode="json")
    return {
        **body,
        "dataset_id": dataset_id,
        "staple_count": len(design.staples),
        "candidate_count": sum(len(s.candidates) for s in design.staples),
        "created_at": now(),
        "schema_version": SCHEMA_VERSION,
    }


def run_ingest(
    db: Any, storage: StorageBackend, limits: IngestLimits, job_id: str, *, batch_size: int, actor: str
) -> None:
    """Idempotent: safe to run again for the same job after a crash (designs are replaced)."""
    oid = ObjectId(job_id)
    job = transition(
        db,
        oid,
        JobStatus.QUEUED,
        JobStatus.RUNNING,
        actor=actor,
        fields={"worker_id": actor, "started_at": now(), "heartbeat_at": now()},
    )
    if job is None:
        log.info("ingest job %s not claimable (already taken or cancelled)", job_id)
        return

    dataset = db.datasets.find_one({"_id": job["dataset_id"], "deleted_at": None})
    if dataset is None:
        transition(
            db,
            oid,
            JobStatus.RUNNING,
            JobStatus.FAILED,
            actor=actor,
            fields={
                "finished_at": now(),
                "error": {"code": "DATASET_MISSING", "message": "Dataset deleted", "retryable": False},
            },
        )
        return

    ds_id = dataset["_id"]
    fmt = DesignFormat(dataset["format"])
    db.datasets.update_one(
        {"_id": ds_id}, {"$set": {"status": DatasetStatus.INGESTING.value, "updated_at": now()}}
    )
    db.designs.delete_many({"dataset_id": ds_id})

    report = new_report(fmt, limits)
    error: dict[str, Any] | None = None
    try:
        with storage.open_read(dataset["storage_key"]) as fh:
            batch: list[dict[str, Any]] = []
            for design in parse_designs(fh, fmt, limits, report):
                batch.append(design_document(design, ds_id))
                if len(batch) >= batch_size:
                    db.designs.insert_many(batch, ordered=False)
                    batch = []
                    heartbeat(
                        db, oid, {"records_read": report.records_read, "designs_valid": report.designs_valid}
                    )
            if batch:
                db.designs.insert_many(batch, ordered=False)
    except IngestAborted as exc:
        error = {"code": exc.issue.code, "message": exc.issue.message, "retryable": False}
    except Exception as exc:
        log.exception("ingest job %s crashed", job_id)
        report.fatal = Issue("E_INTERNAL", f"Internal error: {type(exc).__name__}")
        error = {"code": "INTERNAL", "message": type(exc).__name__, "retryable": True}

    if error is None and report.designs_valid == 0:
        report.fatal = Issue("E_NO_VALID_DESIGNS", "No valid designs found")
        error = {"code": "E_NO_VALID_DESIGNS", "message": "No valid designs found", "retryable": False}

    if error is not None:
        # Never leave a half-imported dataset behind.
        db.designs.delete_many({"dataset_id": ds_id})
        status = DatasetStatus.FAILED
    elif report.error_count:
        status = DatasetStatus.READY_WITH_ERRORS
    else:
        status = DatasetStatus.READY

    report_key = f"reports/{ds_id}/validation.json"
    with storage.open_write(report_key) as out:
        out.write(json.dumps(report.full(), separators=(",", ":")).encode())

    summary = report.summary()
    db.datasets.update_one(
        {"_id": ds_id},
        {
            "$set": {
                "status": status.value,
                "report": summary,
                "report_key": report_key,
                "counts": {
                    k: summary[k]
                    for k in (
                        "records_read",
                        "designs_valid",
                        "designs_invalid",
                        "error_count",
                        "warning_count",
                    )
                },
                "updated_at": now(),
            }
        },
    )
    final = JobStatus.FAILED if error else JobStatus.COMPLETED
    transition(
        db,
        oid,
        JobStatus.RUNNING,
        final,
        actor=actor,
        fields={
            "finished_at": now(),
            "error": error,
            "progress": {"records_read": report.records_read, "designs_valid": report.designs_valid},
        },
    )


@celery_app.task(name=INGEST_DATASET)
def ingest_dataset(job_id: str) -> None:
    settings = get_settings()
    run_ingest(
        get_db(),
        get_storage(),
        settings.ingest_limits(),
        job_id,
        batch_size=settings.ingest_batch_size,
        actor=f"worker:{socket.gethostname()}:{os.getpid()}",
    )
