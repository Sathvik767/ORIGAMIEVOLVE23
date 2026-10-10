"""Structure import (M7): oxDNA topology + configuration, or caDNAno JSON (topology only).

Uploads are raw request bodies streamed to storage (same convention as datasets). Parsing and
validation run in the worker; the API only stores files, records state and serves results.
"""

import json
import logging
from collections.abc import Iterator
from enum import StrEnum
from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from starlette.requests import ClientDisconnect

from origami_api.db import SCHEMA_VERSION
from origami_api.routers.common import Cursor, Limit, next_cursor, now, parse_cursor, parse_oid
from origami_api.schemas import Page, StructureOut, structure_out
from origami_api.security import CurrentPrincipal
from origami_api.services.uploads import StoredUpload, UploadTooLarge, stream_to_storage
from origami_worker.task_names import CONVERT_STRUCTURE, SIMULATE_STRUCTURE, VALIDATE_STRUCTURE

log = logging.getLogger(__name__)
router = APIRouter(prefix="/structures", tags=["structures"])


class StructureFormat(StrEnum):
    OXDNA = "oxdna"
    CADNANO = "cadnano"


class Protocol(StrEnum):
    RELAX = "relax"
    MD = "md"


class Lattice(StrEnum):
    SQUARE = "square"
    HONEYCOMB = "honeycomb"


def _keys(structure_id: Any) -> dict[str, str]:
    base = f"structures/{structure_id}"
    return {
        "topology": f"{base}/topology.top",
        "configuration": f"{base}/configuration.dat",
        "cadnano": f"{base}/design.json",
    }


async def _receive(request: Request) -> StoredUpload:
    settings = request.app.state.settings
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > settings.max_structure_bytes:
        raise HTTPException(413, f"File exceeds {settings.max_structure_bytes} bytes")
    try:
        up = await stream_to_storage(
            request.stream(),
            request.app.state.storage,
            max_bytes=settings.max_structure_bytes,
            buffer_bytes=settings.upload_buffer_bytes,
        )
    except UploadTooLarge:
        raise HTTPException(413, f"File exceeds {settings.max_structure_bytes} bytes") from None
    except ClientDisconnect:
        raise HTTPException(400, "Client disconnected during upload") from None
    if up.size_bytes == 0:
        request.app.state.storage.delete(up.tmp_key)
        raise HTTPException(422, "Upload is empty")
    return up


def _sniff(up: StoredUpload, kind: str) -> str | None:
    try:
        head = up.prefix.decode("utf-8", errors="strict" if len(up.prefix) < 4096 else "ignore").lstrip()
    except UnicodeDecodeError:
        return "File is not UTF-8 text"
    first = head.split(maxsplit=1)[0] if head else ""
    if kind == "cadnano" and not head.startswith("{"):
        return "caDNAno files are JSON objects"
    if kind == "topology" and not first.isdigit():
        return "oxDNA topology files start with 'N_nucleotides N_strands'"
    if kind == "configuration" and not head.startswith("t"):
        return "oxDNA configuration files start with 't = ...'"
    return None


async def _get(db: Any, structure_id: str) -> dict[str, Any]:
    doc: dict[str, Any] | None = await db.structures.find_one({"_id": parse_oid(structure_id)})
    if doc is None:
        raise HTTPException(404, "Structure not found")
    return doc


async def _start(request: Request, doc: dict[str, Any], status: str, task: str, *args: Any) -> dict[str, Any]:
    db = request.app.state.db
    await db.structures.update_one({"_id": doc["_id"]}, {"$set": {"status": status, "updated_at": now()}})
    try:
        await request.app.state.dispatch(task, str(doc["_id"]), *args)
    except Exception as exc:
        log.exception("failed to enqueue %s for structure %s", task, doc["_id"])
        issue = {
            "code": "DISPATCH_FAILED",
            "message": f"Queue unavailable: {type(exc).__name__}",
            "severity": "error",
            "location": None,
        }
        await db.structures.update_one(
            {"_id": doc["_id"], "status": status},
            {"$set": {"status": "invalid", "issues": [issue], "updated_at": now()}},
        )
    result: dict[str, Any] = await db.structures.find_one({"_id": doc["_id"]})
    return result


@router.post("", status_code=202, response_model=StructureOut)
async def import_structure(
    request: Request,
    principal: CurrentPrincipal,
    name: Annotated[str, Query(min_length=1, max_length=200)],
    format: StructureFormat,
    design_id: Annotated[str | None, Query(max_length=24)] = None,
) -> StructureOut:
    """Upload a caDNAno JSON file, or the **topology** of an oxDNA structure (then PUT its configuration).

    Linking a `design_id` enables verified staple mapping: design strands are matched to structure
    strands only by identical sequence."""
    db = request.app.state.db
    storage = request.app.state.storage
    design_oid = None
    if design_id is not None:
        design_oid = parse_oid(design_id, not_found="Design not found")
        if await db.designs.count_documents({"_id": design_oid}) == 0:
            raise HTTPException(404, "Design not found")
    up = await _receive(request)
    kind = "cadnano" if format is StructureFormat.CADNANO else "topology"
    if problem := _sniff(up, kind):
        storage.delete(up.tmp_key)
        raise HTTPException(415, f"Content does not look like a {format.value} {kind} file: {problem}")
    oid = ObjectId()
    storage.move(up.tmp_key, _keys(oid)[kind])
    at = now()
    doc: dict[str, Any] = {
        "_id": oid,
        "name": name.strip(),
        "format": format.value,
        "design_id": design_oid,
        "status": "awaiting_configuration",
        "files": {kind: {"size_bytes": up.size_bytes, "sha256": up.sha256}},
        "summary": None,
        "issues": [],
        "mapping": None,
        "conversion": None,
        "owner": principal.token_id,
        "created_at": at,
        "updated_at": at,
        "schema_version": SCHEMA_VERSION,
    }
    await db.structures.insert_one(doc)
    if format is StructureFormat.CADNANO:
        doc = await _start(request, doc, "validating", VALIDATE_STRUCTURE)
    return structure_out(doc)


@router.put("/{structure_id}/configuration", status_code=202, response_model=StructureOut)
async def upload_configuration(request: Request, _: CurrentPrincipal, structure_id: str) -> StructureOut:
    """Upload the oxDNA configuration (.dat / .oxdna) for a structure whose topology was uploaded."""
    db = request.app.state.db
    doc = await _get(db, structure_id)
    if doc["format"] != "oxdna":
        raise HTTPException(409, "Only oxDNA structures have a configuration file")
    if doc["status"] not in ("awaiting_configuration", "invalid", "ready"):
        raise HTTPException(409, f"Structure is {doc['status']}; wait until it finishes")
    up = await _receive(request)
    if problem := _sniff(up, "configuration"):
        request.app.state.storage.delete(up.tmp_key)
        raise HTTPException(415, f"Content does not look like an oxDNA configuration: {problem}")
    request.app.state.storage.move(up.tmp_key, _keys(doc["_id"])["configuration"])
    await db.structures.update_one(
        {"_id": doc["_id"]},
        {"$set": {"files.configuration": {"size_bytes": up.size_bytes, "sha256": up.sha256}}},
    )
    return structure_out(await _start(request, doc, "validating", VALIDATE_STRUCTURE))


@router.post("/{structure_id}/validate", status_code=202, response_model=StructureOut)
async def revalidate(request: Request, _: CurrentPrincipal, structure_id: str) -> StructureOut:
    db = request.app.state.db
    doc = await _get(db, structure_id)
    complete = "cadnano" in doc["files"] or {"topology", "configuration"} <= doc["files"].keys()
    if not complete:
        raise HTTPException(409, "Upload the oxDNA configuration first")
    if doc["status"].startswith(("validating", "converting")):
        raise HTTPException(409, "Structure is already being processed")
    return structure_out(await _start(request, doc, "validating", VALIDATE_STRUCTURE))


@router.post("/{structure_id}/convert", status_code=202, response_model=StructureOut)
async def convert(request: Request, _: CurrentPrincipal, structure_id: str, lattice: Lattice) -> StructureOut:
    """Convert a validated caDNAno design to oxDNA coordinates with tacoxDNA (optional external tool).

    The lattice type must be stated by the user (caDNAno 2 files do not record it), and the structure
    must be linked to a design with a scaffold sequence, which is passed to the converter."""
    db = request.app.state.db
    doc = await _get(db, structure_id)
    if doc["format"] != "cadnano" or doc["status"] != "topology_only":
        raise HTTPException(409, "Only validated caDNAno structures (status topology_only) can be converted")
    tdir = request.app.state.settings.tacoxdna_dir
    if tdir is None or not (tdir / "cadnano_oxDNA.py").is_file():
        raise HTTPException(
            503, "Converter not configured: set ORIGAMI_TACOXDNA_DIR to a tacoxDNA installation"
        )
    if doc.get("design_id") is None:
        raise HTTPException(409, "Link the structure to a design with a scaffold sequence before converting")
    return structure_out(await _start(request, doc, "converting", CONVERT_STRUCTURE, lattice.value))


@router.post("/{structure_id}/simulate", status_code=202, response_model=StructureOut)
async def simulate(
    request: Request,
    principal: CurrentPrincipal,
    structure_id: str,
    protocol: Protocol = Protocol.RELAX,
    steps: Annotated[int, Query(ge=1)] = 10_000,
) -> StructureOut:
    """Relax (MC with capped backbone forces) or simulate (MD) a ready oxDNA structure with the configured
    oxDNA executable. The output is stored as a NEW structure (origin `simulated`); the source is kept."""
    db = request.app.state.db
    settings = request.app.state.settings
    parent = await _get(db, structure_id)
    if parent["format"] != "oxdna" or structure_out(parent).status != "ready":
        raise HTTPException(409, "Only oxDNA structures with status 'ready' can be simulated")
    if steps > settings.simulation_max_steps:
        raise HTTPException(422, f"steps must be at most {settings.simulation_max_steps}")
    if settings.oxdna_bin is None or not settings.oxdna_bin.is_file():
        raise HTTPException(
            503,
            "oxDNA is not installed: set ORIGAMI_OXDNA_BIN to the oxDNA executable "
            "(available inside the api and worker-ingest containers)",
        )
    at = now()
    child: dict[str, Any] = {
        "_id": ObjectId(),
        "name": f"{parent['name']} - oxDNA {protocol.value} ({steps} steps)",
        "format": "oxdna",
        "design_id": parent.get("design_id"),
        "parent_id": parent["_id"],
        "status": "simulating",
        "files": {},
        "summary": None,
        "issues": [],
        "mapping": None,
        "conversion": None,
        "owner": principal.token_id,
        "simulation": {
            "program": "oxDNA",
            "protocol": protocol.value,
            "steps": steps,
            "interaction": "DNA2",
            "temperature": "20C",
            "salt_concentration": 0.5,
            "requested_at": at,
        },
        "created_at": at,
        "updated_at": at,
        "schema_version": SCHEMA_VERSION,
    }
    await db.structures.insert_one(child)
    return structure_out(await _start(request, child, "simulating", SIMULATE_STRUCTURE))


@router.get("/tools")
async def tool_status(request: Request, _: CurrentPrincipal) -> dict[str, Any]:
    """Whether the optional external tools are configured and present (files are checked, not executed)."""
    s = request.app.state.settings

    def status(path: Any, env: str, needs: str) -> dict[str, Any]:
        present = bool(path) and path.is_file()
        return {
            "configured": path is not None,
            "available": present,
            "setting": env,
            "message": None
            if present
            else (
                f"Not available: set {env} to {needs} inside the api and "
                "worker-ingest containers (see README)."
            ),
        }

    return {
        "oxdna": status(s.oxdna_bin, "ORIGAMI_OXDNA_BIN", "a Linux oxDNA executable"),
        "tacoxdna": status(
            s.tacoxdna_dir / "cadnano_oxDNA.py" if s.tacoxdna_dir else None,
            "ORIGAMI_TACOXDNA_DIR",
            "the tacoxDNA src directory",
        ),
    }


@router.get("", response_model=Page[StructureOut])
async def list_structures(
    request: Request,
    _: CurrentPrincipal,
    design_id: Annotated[str | None, Query(max_length=24)] = None,
    limit: Limit = 25,
    cursor: Cursor = None,
) -> Page[StructureOut]:
    query: dict[str, Any] = {}
    if design_id is not None:
        query["design_id"] = parse_oid(design_id, not_found="Design not found")
    if (after := parse_cursor(cursor)) is not None:
        query["_id"] = {"$lt": after}
    docs = (
        await request.app.state.db.structures.find(query).sort("_id", -1).limit(limit).to_list(length=limit)
    )
    return Page(items=[structure_out(d) for d in docs], next_cursor=next_cursor(docs, limit))


@router.get("/{structure_id}", response_model=StructureOut)
async def get_structure(request: Request, _: CurrentPrincipal, structure_id: str) -> StructureOut:
    return structure_out(await _get(request.app.state.db, structure_id))


@router.get("/{structure_id}/geometry")
async def get_geometry(
    request: Request,
    _: CurrentPrincipal,
    structure_id: str,
    job_id: Annotated[str | None, Query(max_length=24)] = None,
) -> Any:
    """Molecular coordinates for the viewer (oxDNA structures with status ready).

    With `job_id`, staples are annotated with that job's selected variants, but only for staples whose
    identity was verified by sequence and only if the job optimized the same design."""
    db = request.app.state.db
    storage = request.app.state.storage
    doc = await _get(db, structure_id)
    key = doc.get("geometry_key")
    if structure_out(doc).status != "ready" or not key or not storage.exists(key):
        raise HTTPException(404, "No molecular coordinates for this structure")
    if job_id is None:

        def chunks() -> Iterator[bytes]:
            with storage.open_read(key) as fh:
                while chunk := fh.read(256 * 1024):
                    yield chunk

        return StreamingResponse(chunks(), media_type="application/json")

    job = await db.jobs.find_one({"_id": parse_oid(job_id, not_found="Job not found")})
    if job is None or job.get("status") != "completed" or not job.get("result"):
        raise HTTPException(404, "Completed job not found")
    if doc.get("design_id") is None or job.get("design_id") != doc["design_id"]:
        raise HTTPException(
            409, "The job optimized a different design than the one this structure is linked to"
        )
    with storage.open_read(key) as fh:
        geometry: dict[str, Any] = json.loads(fh.read())
    with storage.open_read(job["result"]["result_key"]) as fh:
        selected = {v["staple_id"]: v for v in json.loads(fh.read())["selected_variants"]}
    design = await db.designs.find_one({"_id": doc["design_id"]}, {"staples.id": 1, "staples.sequence": 1})
    lengths = {s["id"]: len(s["sequence"]) for s in (design or {}).get("staples", [])}
    for strand in geometry["strands"]:
        v = selected.get(strand.get("design_strand_id") or "")
        if v is not None:
            strand["variant"] = {
                "choice": v["choice"],
                "is_original": v["is_original"],
                "length_compatible": len(v["sequence"]) == lengths.get(v["staple_id"]),
            }
    geometry["annotated_job_id"] = job_id
    return geometry
