"""Response DTOs. Kept separate from Mongo documents so storage fields never leak by accident."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from origami_core.jobs import BatchStatus, DatasetStatus, JobStatus, JobType
from origami_core.models import DesignFormat, Measurement, MetadataValue, Strand


class DatasetCounts(BaseModel):
    records_read: int = 0
    designs_valid: int = 0
    designs_invalid: int = 0
    error_count: int = 0
    warning_count: int = 0


class JobBrief(BaseModel):
    id: str
    status: JobStatus
    error: dict[str, Any] | None = None


class DatasetOut(BaseModel):
    id: str
    name: str
    description: str | None
    format: DesignFormat
    original_filename: str | None
    size_bytes: int
    sha256: str
    status: DatasetStatus
    counts: DatasetCounts
    ingest_job: JobBrief | None = None
    created_at: datetime
    updated_at: datetime


class UploadResult(BaseModel):
    dataset: DatasetOut
    duplicate: bool


class Page[T](BaseModel):
    items: list[T]
    next_cursor: str | None


class ReportSummary(BaseModel):
    location_kind: str
    records_read: int
    designs_valid: int
    designs_invalid: int
    error_count: int
    warning_count: int
    errors_by_code: dict[str, int]
    warnings_by_code: dict[str, int]
    samples: dict[str, list[dict[str, Any]]]
    fatal: dict[str, Any] | None


class DesignSummary(BaseModel):
    id: str
    external_id: str
    name: str | None
    has_scaffold: bool
    scaffold_length: int | None
    staple_count: int
    candidate_count: int
    measurement_names: list[str]


class DesignOut(BaseModel):
    id: str
    dataset_id: str
    external_id: str
    name: str | None
    scaffold: Strand | None
    staples: list[Strand]
    metadata: dict[str, MetadataValue]
    # User-imported values with provenance; never computed by OrigamiEvolve.
    measurements: list[Measurement]


class BatchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: str = Field(min_length=1, max_length=24)
    # Omit to optimize every design in the dataset.
    design_ids: list[str] | None = Field(default=None, min_length=1, max_length=10_000)
    seed: int = Field(default=42, ge=0, le=2**32 - 1)
    name: str | None = Field(default=None, max_length=200)
    # Objective name from GET /fitness-functions; default keeps the original behaviour.
    fitness: str = Field(default="synthetic_gc_balance_demo", max_length=100)


class BatchOut(BaseModel):
    id: str
    name: str | None
    dataset_id: str
    status: BatchStatus
    counts: dict[str, int]
    total_jobs: int
    params: dict[str, Any]
    fitness: dict[str, str]
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None = None


class JobOut(BaseModel):
    id: str
    type: JobType
    status: JobStatus
    batch_id: str | None = None
    dataset_id: str | None = None
    design_id: str | None = None
    external_id: str | None = None
    attempt: int
    cancel_requested: bool = False
    progress: dict[str, Any] = Field(default_factory=dict)
    error: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    queued_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    updated_at: datetime


def batch_out(doc: dict[str, Any]) -> BatchOut:
    return BatchOut(
        id=str(doc["_id"]),
        name=doc.get("name"),
        dataset_id=str(doc["dataset_id"]),
        status=doc["status"],
        counts=doc.get("counts", {}),
        total_jobs=doc["total_jobs"],
        params=doc["params"],
        fitness=doc["fitness"],
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
        finished_at=doc.get("finished_at"),
    )


def job_out(doc: dict[str, Any]) -> JobOut:
    def sid(key: str) -> str | None:
        return str(doc[key]) if doc.get(key) is not None else None

    return JobOut(
        id=str(doc["_id"]),
        type=doc["type"],
        status=doc["status"],
        batch_id=sid("batch_id"),
        dataset_id=sid("dataset_id"),
        design_id=sid("design_id"),
        external_id=doc.get("external_id"),
        attempt=doc.get("attempt", 1),
        cancel_requested=doc.get("cancel_requested", False),
        progress=doc.get("progress") or {},
        error=doc.get("error"),
        result=doc.get("result"),
        queued_at=doc.get("queued_at"),
        started_at=doc.get("started_at"),
        finished_at=doc.get("finished_at"),
        updated_at=doc["updated_at"],
    )


def dataset_out(doc: dict[str, Any], job: dict[str, Any] | None) -> DatasetOut:
    return DatasetOut(
        id=str(doc["_id"]),
        name=doc["name"],
        description=doc.get("description"),
        format=doc["format"],
        original_filename=doc.get("original_filename"),
        size_bytes=doc["size_bytes"],
        sha256=doc["sha256"],
        status=doc["status"],
        counts=DatasetCounts(**doc.get("counts", {})),
        ingest_job=JobBrief(id=str(job["_id"]), status=job["status"], error=job.get("error"))
        if job
        else None,
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


def design_summary(doc: dict[str, Any]) -> DesignSummary:
    scaffold = doc.get("scaffold")
    return DesignSummary(
        id=str(doc["_id"]),
        external_id=doc["external_id"],
        name=doc.get("name"),
        has_scaffold=scaffold is not None,
        scaffold_length=len(scaffold["sequence"]) if scaffold else None,
        staple_count=doc.get("staple_count", 0),
        candidate_count=doc.get("candidate_count", 0),
        measurement_names=[m["name"] for m in doc.get("measurements", [])],
    )


def design_out(doc: dict[str, Any]) -> DesignOut:
    return DesignOut(
        id=str(doc["_id"]),
        dataset_id=str(doc["dataset_id"]),
        external_id=doc["external_id"],
        name=doc.get("name"),
        scaffold=doc.get("scaffold"),
        staples=doc.get("staples", []),
        metadata=doc.get("metadata", {}),
        measurements=doc.get("measurements", []),
    )


class StructureOut(BaseModel):
    id: str
    name: str
    format: str  # "oxdna" | "cadnano"
    design_id: str | None
    # awaiting_configuration | validating | converting | ready | topology_only | invalid
    status: str
    has_coordinates: bool
    summary: dict[str, Any] | None = None
    issues: list[dict[str, Any]] = Field(default_factory=list)
    mapping: dict[str, Any] | None = None
    conversion: dict[str, Any] | None = None
    # imported = coordinates from an uploaded file; generated = tacoxDNA from caDNAno (initial geometry,
    # not relaxed); simulated = output of an oxDNA relaxation/simulation run.
    origin: str = "imported"
    parent_id: str | None = None
    simulation: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


def structure_out(doc: dict[str, Any]) -> StructureOut:
    status = str(doc["status"]).removesuffix(":running")
    return StructureOut(
        id=str(doc["_id"]),
        name=doc["name"],
        format=doc["format"],
        design_id=str(doc["design_id"]) if doc.get("design_id") else None,
        status=status,
        has_coordinates=status == "ready",
        summary=doc.get("summary"),
        issues=doc.get("issues") or [],
        mapping=doc.get("mapping"),
        conversion=doc.get("conversion"),
        origin="simulated"
        if doc.get("simulation")
        else "generated"
        if (doc.get("conversion") or {}).get("tool")
        else "imported",
        parent_id=str(doc["parent_id"]) if doc.get("parent_id") else None,
        simulation=doc.get("simulation"),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


class FitnessFunctionOut(BaseModel):
    name: str
    version: str
    kind: str
    description: str
    limitations: str
    requires: str
