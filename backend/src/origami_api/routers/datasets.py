import logging
from collections.abc import Iterator
from pathlib import PurePosixPath
from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from starlette.requests import ClientDisconnect

from origami_api.db import SCHEMA_VERSION
from origami_api.routers.common import Cursor, Limit, next_cursor, now, parse_cursor, parse_oid
from origami_api.schemas import (
    DatasetOut,
    DesignCompatibility,
    DesignSummary,
    Page,
    ReportSummary,
    UploadResult,
    dataset_out,
    design_summary,
)
from origami_api.security import CurrentPrincipal
from origami_api.services.uploads import UploadTooLarge, stream_to_storage
from origami_core.fitness import REGISTRY, get_fitness, incompatibility
from origami_core.ingest import sniff
from origami_core.jobs import ACTIVE, DatasetStatus, JobStatus, JobType
from origami_core.models import DesignFormat, design_from_doc
from origami_worker.task_names import INGEST_DATASET

log = logging.getLogger(__name__)
router = APIRouter(prefix="/datasets", tags=["datasets"])


async def _get_dataset(db: Any, dataset_id: str) -> dict[str, Any]:
    doc: dict[str, Any] | None = await db.datasets.find_one(
        {"_id": parse_oid(dataset_id), "deleted_at": None}
    )
    if doc is None:
        raise HTTPException(404, "Dataset not found")
    return doc


async def _job(db: Any, dataset: dict[str, Any]) -> dict[str, Any] | None:
    job_id = dataset.get("ingest_job_id")
    return await db.jobs.find_one({"_id": job_id}) if job_id else None


async def _start_ingest(request: Request, dataset: dict[str, Any], actor: str) -> dict[str, Any]:
    """Create a queued ingest job and enqueue it. A broker failure fails the job visibly
    (retryable via POST /datasets/{id}/ingest) instead of leaving it queued forever."""
    db = request.app.state.db
    at = now()
    job: dict[str, Any] = {
        "_id": ObjectId(),
        "type": JobType.INGEST.value,
        "dataset_id": dataset["_id"],
        "status": JobStatus.QUEUED.value,
        "attempt": 1,
        "max_attempts": 1,
        "cancel_requested": False,
        "progress": {},
        "error": None,
        "queued_at": at,
        "created_at": at,
        "updated_at": at,
        "schema_version": SCHEMA_VERSION,
    }
    await db.jobs.insert_one(job)
    await db.job_events.insert_one(
        {
            "job_id": job["_id"],
            "at": at,
            "from": None,
            "to": "queued",
            "attempt": 1,
            "actor": actor,
            "detail": {},
        }
    )
    await db.datasets.update_one(
        {"_id": dataset["_id"]},
        {"$set": {"ingest_job_id": job["_id"], "status": DatasetStatus.UPLOADED.value, "updated_at": at}},
    )
    dataset.update(ingest_job_id=job["_id"], status=DatasetStatus.UPLOADED.value, updated_at=at)
    try:
        await request.app.state.dispatch(INGEST_DATASET, str(job["_id"]))
    except Exception as exc:
        log.exception("failed to enqueue ingest job %s", job["_id"])
        error = {
            "code": "DISPATCH_FAILED",
            "message": f"Queue unavailable: {type(exc).__name__}",
            "retryable": True,
        }
        failed = await db.jobs.find_one_and_update(
            {"_id": job["_id"], "status": JobStatus.QUEUED.value},
            {
                "$set": {
                    "status": JobStatus.FAILED.value,
                    "error": error,
                    "finished_at": now(),
                    "updated_at": now(),
                }
            },
            return_document=ReturnDocument.AFTER,
        )
        if failed is not None:
            job = failed
            await db.job_events.insert_one(
                {
                    "job_id": job["_id"],
                    "at": now(),
                    "from": "queued",
                    "to": "failed",
                    "attempt": 1,
                    "actor": "api",
                    "detail": error,
                }
            )
            await db.datasets.update_one(
                {"_id": dataset["_id"]}, {"$set": {"status": DatasetStatus.FAILED.value}}
            )
            dataset["status"] = DatasetStatus.FAILED.value
    return job


@router.post("", status_code=202, response_model=UploadResult, responses={200: {"model": UploadResult}})
async def upload_dataset(
    request: Request,
    response: Response,
    principal: CurrentPrincipal,
    name: Annotated[str, Query(min_length=1, max_length=200)],
    format: DesignFormat,
    filename: Annotated[str | None, Query(max_length=255)] = None,
    description: Annotated[str | None, Query(max_length=2000)] = None,
) -> UploadResult:
    """Upload a dataset as the raw request body (streamed; see docs/input-formats.md).

    Returns 202 with a queued ingest job, or 200 with the existing dataset if identical
    content (same SHA-256) was already uploaded."""
    settings = request.app.state.settings
    storage = request.app.state.storage
    db = request.app.state.db

    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > settings.max_upload_bytes:
        raise HTTPException(413, f"Upload exceeds {settings.max_upload_bytes} bytes")
    try:
        up = await stream_to_storage(
            request.stream(),
            storage,
            max_bytes=settings.max_upload_bytes,
            buffer_bytes=settings.upload_buffer_bytes,
        )
    except UploadTooLarge:
        raise HTTPException(413, f"Upload exceeds {settings.max_upload_bytes} bytes") from None
    except ClientDisconnect:
        raise HTTPException(400, "Client disconnected during upload") from None

    if up.size_bytes == 0:
        storage.delete(up.tmp_key)
        raise HTTPException(422, "Upload is empty")
    if problem := sniff(up.prefix, format):
        storage.delete(up.tmp_key)
        raise HTTPException(415, f"Content does not look like {format.value}: {problem}")

    existing = await db.datasets.find_one({"dedupe_key": up.sha256})
    if existing is not None:
        storage.delete(up.tmp_key)
        response.status_code = 200
        return UploadResult(dataset=dataset_out(existing, await _job(db, existing)), duplicate=True)

    ds_id = ObjectId()
    key = f"raw/{ds_id}/{up.sha256}.{format.value}"
    storage.move(up.tmp_key, key)
    at = now()
    doc: dict[str, Any] = {
        "_id": ds_id,
        "name": name.strip(),
        "description": description,
        "format": format.value,
        # Display only: path components stripped, never used to build storage paths.
        "original_filename": PurePosixPath(filename.replace("\\", "/")).name if filename else None,
        "storage_key": key,
        "size_bytes": up.size_bytes,
        "sha256": up.sha256,
        "dedupe_key": up.sha256,
        "status": DatasetStatus.UPLOADED.value,
        "counts": {},
        "owner": principal.token_id,
        "created_at": at,
        "updated_at": at,
        "deleted_at": None,
        "schema_version": SCHEMA_VERSION,
    }
    try:
        await db.datasets.insert_one(doc)
    except DuplicateKeyError:  # concurrent identical upload won the race
        storage.delete(key)
        existing = await db.datasets.find_one({"dedupe_key": up.sha256})
        response.status_code = 200
        return UploadResult(dataset=dataset_out(existing, await _job(db, existing)), duplicate=True)

    job = await _start_ingest(request, doc, actor=principal.name)
    return UploadResult(dataset=dataset_out(doc, job), duplicate=False)


@router.get("", response_model=Page[DatasetOut])
async def list_datasets(
    request: Request,
    _: CurrentPrincipal,
    status: DatasetStatus | None = None,
    limit: Limit = 25,
    cursor: Cursor = None,
) -> Page[DatasetOut]:
    db = request.app.state.db
    query: dict[str, Any] = {"deleted_at": None}
    if status:
        query["status"] = status.value
    if (after := parse_cursor(cursor)) is not None:
        query["_id"] = {"$lt": after}
    docs = await db.datasets.find(query).sort("_id", -1).limit(limit).to_list(length=limit)
    job_ids = [d["ingest_job_id"] for d in docs if d.get("ingest_job_id")]
    jobs = {j["_id"]: j for j in await db.jobs.find({"_id": {"$in": job_ids}}).to_list(length=None)}
    items = [dataset_out(d, jobs.get(d.get("ingest_job_id"))) for d in docs]
    return Page(items=items, next_cursor=next_cursor(docs, limit))


@router.get("/{dataset_id}", response_model=DatasetOut)
async def get_dataset(request: Request, _: CurrentPrincipal, dataset_id: str) -> DatasetOut:
    db = request.app.state.db
    doc = await _get_dataset(db, dataset_id)
    return dataset_out(doc, await _job(db, doc))


@router.post("/{dataset_id}/ingest", status_code=202, response_model=DatasetOut)
async def reingest_dataset(request: Request, principal: CurrentPrincipal, dataset_id: str) -> DatasetOut:
    """Run ingestion again (e.g. after a queue outage or with new limits). Replaces existing designs."""
    db = request.app.state.db
    doc = await _get_dataset(db, dataset_id)
    current = await _job(db, doc)
    if current is not None and current["status"] in ACTIVE:
        raise HTTPException(409, "Ingestion is already queued or running")
    job = await _start_ingest(request, doc, actor=principal.name)
    return dataset_out(doc, job)


@router.delete("/{dataset_id}", status_code=204)
async def delete_dataset(request: Request, _: CurrentPrincipal, dataset_id: str) -> Response:
    """Soft delete. Stored files are purged later by the retention task."""
    db = request.app.state.db
    doc = await _get_dataset(db, dataset_id)
    current = await _job(db, doc)
    if current is not None and current["status"] in ACTIVE:
        raise HTTPException(409, "Cannot delete while ingestion is queued or running")
    await db.datasets.update_one(
        {"_id": doc["_id"]},
        {"$set": {"deleted_at": now(), "updated_at": now()}, "$unset": {"dedupe_key": ""}},
    )
    return Response(status_code=204)


@router.get("/{dataset_id}/report", response_model=ReportSummary)
async def get_report(request: Request, _: CurrentPrincipal, dataset_id: str) -> ReportSummary:
    doc = await _get_dataset(request.app.state.db, dataset_id)
    if not doc.get("report"):
        raise HTTPException(404, "Validation report not available yet")
    return ReportSummary(**doc["report"])


@router.get("/{dataset_id}/report/download")
async def download_report(request: Request, _: CurrentPrincipal, dataset_id: str) -> StreamingResponse:
    doc = await _get_dataset(request.app.state.db, dataset_id)
    key = doc.get("report_key")
    storage = request.app.state.storage
    if not key or not storage.exists(key):
        raise HTTPException(404, "Validation report not available yet")

    def chunks() -> Iterator[bytes]:
        with storage.open_read(key) as fh:
            while chunk := fh.read(64 * 1024):
                yield chunk

    return StreamingResponse(
        chunks(),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="validation-{doc["_id"]}.json"'},
    )


@router.get("/{dataset_id}/designs", response_model=Page[DesignSummary])
async def list_designs(
    request: Request, _: CurrentPrincipal, dataset_id: str, limit: Limit = 50, cursor: Cursor = None
) -> Page[DesignSummary]:
    db = request.app.state.db
    doc = await _get_dataset(db, dataset_id)
    query: dict[str, Any] = {"dataset_id": doc["_id"]}
    if (after := parse_cursor(cursor)) is not None:
        query["_id"] = {"$gt": after}
    projection = {"staples": 0, "metadata": 0}
    docs = await db.designs.find(query, projection).sort("_id", 1).limit(limit).to_list(length=limit)
    return Page(items=[design_summary(d) for d in docs], next_cursor=next_cursor(docs, limit))


@router.get("/{dataset_id}/compatibility", response_model=Page[DesignCompatibility])
async def design_compatibility(
    request: Request,
    _: CurrentPrincipal,
    dataset_id: str,
    fitness: Annotated[str, Query(max_length=100)],
    limit: Limit = 50,
    cursor: Cursor = None,
) -> Page[DesignCompatibility]:
    """Whether `fitness` can score each design (its check_design()), paged like GET /designs."""
    if fitness not in REGISTRY:
        raise HTTPException(422, f"Unknown fitness function {fitness!r}; see GET /fitness-functions")
    objective = get_fitness(fitness)
    db = request.app.state.db
    doc = await _get_dataset(db, dataset_id)
    query: dict[str, Any] = {"dataset_id": doc["_id"]}
    if (after := parse_cursor(cursor)) is not None:
        query["_id"] = {"$gt": after}
    docs = await db.designs.find(query).sort("_id", 1).limit(limit).to_list(length=limit)
    items = []
    for d in docs:
        reason = incompatibility(objective, design_from_doc(d))
        items.append(
            DesignCompatibility(
                design_id=str(d["_id"]),
                external_id=d["external_id"],
                compatible=reason is None,
                reason=reason,
            )
        )
    return Page(items=items, next_cursor=next_cursor(docs, limit))
