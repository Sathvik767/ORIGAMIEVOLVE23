"""Structure validation and (optional) caDNAno -> oxDNA conversion. Runs in the worker, never in the API."""

import json
import logging
import subprocess
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument

from origami_api.config import get_settings
from origami_core.models import Design
from origami_core.storage import StorageBackend
from origami_core.structure import StructureError, StructureLimits, map_design, parse_cadnano, parse_oxdna
from origami_core.structure.oxdna import viewer_geometry
from origami_worker.celery_app import celery_app
from origami_worker.db import get_db, get_storage
from origami_worker.job_state import now
from origami_worker.task_names import CONVERT_STRUCTURE, SIMULATE_STRUCTURE, VALIDATE_STRUCTURE

log = logging.getLogger(__name__)
DESIGN_FIELDS = tuple(Design.model_fields)


def keys(structure_id: Any) -> dict[str, str]:
    base = f"structures/{structure_id}"
    return {
        "topology": f"{base}/topology.top",
        "configuration": f"{base}/configuration.dat",
        "cadnano": f"{base}/design.json",
        "geometry": f"{base}/geometry.json",
    }


def _read(storage: StorageBackend, key: str) -> str:
    with storage.open_read(key) as fh:
        return fh.read().decode("utf-8")


def _claim(db: Any, oid: ObjectId, expected: str) -> dict[str, Any] | None:
    doc: dict[str, Any] | None = db.structures.find_one_and_update(
        {"_id": oid, "status": expected},
        {"$set": {"status": f"{expected}:running", "updated_at": now()}},
        return_document=ReturnDocument.AFTER,
    )
    return doc


def _finish(db: Any, oid: ObjectId, fields: dict[str, Any]) -> None:
    db.structures.update_one({"_id": oid}, {"$set": {**fields, "updated_at": now()}})


def run_validate(db: Any, storage: StorageBackend, structure_id: str, limits: StructureLimits) -> None:
    oid = ObjectId(structure_id)
    doc = _claim(db, oid, "validating")
    if doc is None:
        log.info("structure %s not in 'validating' state; skipping", structure_id)
        return
    k = keys(oid)
    try:
        if doc["format"] == "cadnano":
            summary = parse_cadnano(_read(storage, k["cadnano"]), limits).summary()
            _finish(db, oid, {"status": "topology_only", "summary": summary, "issues": [], "mapping": None})
            return
        structure = parse_oxdna(_read(storage, k["topology"]), _read(storage, k["configuration"]), limits)
    except StructureError as exc:
        _finish(db, oid, {"status": "invalid", "issues": [asdict(i) for i in exc.issues]})
        return
    except (UnicodeDecodeError, OSError) as exc:
        _finish(
            db,
            oid,
            {
                "status": "invalid",
                "issues": [
                    {
                        "code": "E_FILE",
                        "message": f"Cannot read file: {type(exc).__name__}",
                        "severity": "error",
                        "location": None,
                    }
                ],
            },
        )
        return

    mapping = None
    if doc.get("design_id") is not None:
        ddoc = db.designs.find_one({"_id": doc["design_id"]})
        if ddoc is not None:
            design = Design.model_validate({f: ddoc[f] for f in DESIGN_FIELDS if f in ddoc})
            mapping = map_design(design, structure)
    geometry = viewer_geometry(structure, mapping.roles() if mapping else None)
    with storage.open_write(k["geometry"]) as out:
        out.write(json.dumps(geometry, separators=(",", ":")).encode())
    _finish(
        db,
        oid,
        {
            "status": "ready",
            "summary": structure.summary(),
            "geometry_key": k["geometry"],
            "issues": [asdict(w) for w in structure.warnings],
            "mapping": mapping.as_dict() if mapping else None,
        },
    )


def run_convert(
    db: Any,
    storage: StorageBackend,
    structure_id: str,
    lattice: str,
    tacoxdna_dir: Path | None,
    timeout_s: int,
    limits: StructureLimits,
) -> None:
    """caDNAno -> oxDNA with tacoxDNA's cadnano_oxDNA.py; the output is validated like any oxDNA upload."""
    oid = ObjectId(structure_id)
    doc = _claim(db, oid, "converting")
    if doc is None:
        return
    k = keys(oid)
    script = tacoxdna_dir / "cadnano_oxDNA.py" if tacoxdna_dir else None
    if script is None or not script.is_file():
        _finish(db, oid, {"status": "topology_only", "conversion": {"error": "tacoxDNA not available"}})
        return
    # Without a sequence file the converter would assign sequences itself; that would be invented data.
    ddoc = db.designs.find_one({"_id": doc["design_id"]}) if doc.get("design_id") else None
    scaffold = (ddoc or {}).get("scaffold") or {}
    if not scaffold.get("sequence"):
        _finish(
            db,
            oid,
            {
                "status": "topology_only",
                "conversion": {"error": "a linked design with a scaffold sequence is required"},
            },
        )
        return
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "design.json"
        src.write_text(_read(storage, k["cadnano"]), encoding="utf-8")
        seq = Path(tmp) / "scaffold.txt"
        seq.write_text(scaffold["sequence"], encoding="ascii")
        args = [sys.executable, str(script), str(src), "sq" if lattice == "square" else "he", str(seq)]
        try:
            # Arguments are a fixed list (no shell): the configured converter path, server-generated temp
            # file names and a lattice value validated against an enum by the API.
            proc = subprocess.run(  # noqa: S603
                args, cwd=tmp, capture_output=True, text=True, timeout=timeout_s, check=False
            )
        except subprocess.TimeoutExpired:
            _finish(
                db, oid, {"status": "topology_only", "conversion": {"error": f"timed out after {timeout_s}s"}}
            )
            return
        tops, confs = (
            sorted(Path(tmp).glob("*.top")),
            sorted(Path(tmp).glob("*.oxdna")) + sorted(Path(tmp).glob("*.dat")),
        )
        if proc.returncode != 0 or len(tops) != 1 or len(confs) != 1:
            tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-3:]
            _finish(
                db,
                oid,
                {
                    "status": "topology_only",
                    "conversion": {"error": f"converter failed (exit {proc.returncode})", "output": tail},
                },
            )
            return
        for key, path in ((k["topology"], tops[0]), (k["configuration"], confs[0])):
            with storage.open_write(key) as out:
                out.write(path.read_bytes())
    _finish(
        db,
        oid,
        {
            "status": "validating",
            "format": "oxdna",
            "conversion": {
                "tool": "tacoxDNA cadnano_oxDNA.py",
                "lattice": lattice,
                "source_format": "cadnano",
                "sequence_source": "linked design scaffold",
                "converted_at": now(),
            },
        },
    )
    run_validate(db, storage, structure_id, limits)


# oxDNA input files. Keys follow the oxDNA documentation's examples (DNA2 model, relaxation with capped
# backbone forces, then MD). They have NOT been run against a real oxDNA build in this project; check them
# against your oxDNA version's documentation.
OXDNA_COMMON = """backend = CPU
interaction_type = DNA2
salt_concentration = 0.5
T = 20C
steps = {steps}
topology = topology.top
conf_file = initial.dat
lastconf_file = last_conf.dat
trajectory_file = trajectory.dat
energy_file = energy.dat
print_conf_interval = {steps}
print_energy_every = {energy_every}
time_scale = linear
restart_step_counter = 1
refresh_vel = 1
"""
OXDNA_PROTOCOLS = {
    # Monte Carlo relaxation with capped backbone forces: removes clashes and stretched bonds.
    "relax": (
        "sim_type = MC\nensemble = NVT\ndelta_translation = 0.1\ndelta_rotation = 0.1\n"
        "max_backbone_force = 5\nmax_backbone_force_far = 10\n"
    ),
    # Molecular dynamics from the given configuration (use after relaxation).
    "md": "sim_type = MD\ndt = 0.003\nthermostat = john\nnewtonian_steps = 103\ndiff_coeff = 2.5\n",
}


def run_simulate(
    db: Any,
    storage: StorageBackend,
    structure_id: str,
    oxdna_bin: Path | None,
    timeout_s: int,
    limits: StructureLimits,
) -> None:
    """Run oxDNA on the parent's files; the final configuration becomes this structure's coordinates."""
    oid = ObjectId(structure_id)
    doc = _claim(db, oid, "simulating")
    if doc is None:
        return
    sim = dict(doc["simulation"])

    def fail(msg: str, extra: dict[str, Any] | None = None) -> None:
        issue = {"code": "E_SIMULATION", "message": msg, "severity": "error", "location": None}
        _finish(
            db,
            oid,
            {"status": "invalid", "simulation": {**sim, "error": msg, **(extra or {})}, "issues": [issue]},
        )

    if oxdna_bin is None or not oxdna_bin.is_file():
        fail("oxDNA executable not available (ORIGAMI_OXDNA_BIN)")
        return
    parent = keys(doc["parent_id"])
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "topology.top").write_text(_read(storage, parent["topology"]), encoding="utf-8")
        (work / "initial.dat").write_text(_read(storage, parent["configuration"]), encoding="utf-8")
        steps = int(sim["steps"])
        (work / "input").write_text(
            OXDNA_COMMON.format(steps=steps, energy_every=max(steps // 10, 1))
            + OXDNA_PROTOCOLS[sim["protocol"]],
            encoding="ascii",
        )
        try:
            # Fixed argument list, no shell: configured executable plus a server-written input file.
            proc = subprocess.run(  # noqa: S603
                [str(oxdna_bin), "input"],
                cwd=tmp,
                capture_output=True,
                text=True,
                timeout=timeout_s,
                check=False,
            )
        except subprocess.TimeoutExpired:
            fail(f"oxDNA timed out after {timeout_s}s")
            return
        last = work / "last_conf.dat"
        if proc.returncode != 0 or not last.is_file():
            tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-3:]
            fail(f"oxDNA failed (exit {proc.returncode})", {"output": tail})
            return
        energy = (
            (work / "energy.dat").read_text(encoding="utf-8").strip().splitlines()[-1:]
            if (work / "energy.dat").is_file()
            else []
        )
        k = keys(oid)
        with storage.open_write(k["topology"]) as out:
            out.write((work / "topology.top").read_bytes())
        with storage.open_write(k["configuration"]) as out:
            out.write(last.read_bytes())
    _finish(
        db,
        oid,
        {
            "status": "validating",
            "simulation": {**sim, "completed_at": now(), "last_energy_line": energy[0] if energy else None},
        },
    )
    run_validate(db, storage, structure_id, limits)


@celery_app.task(name=SIMULATE_STRUCTURE)
def simulate_structure(structure_id: str) -> None:
    s = get_settings()
    run_simulate(
        get_db(), get_storage(), structure_id, s.oxdna_bin, s.simulation_timeout_s, s.structure_limits()
    )


@celery_app.task(name=VALIDATE_STRUCTURE)
def validate_structure(structure_id: str) -> None:
    run_validate(get_db(), get_storage(), structure_id, get_settings().structure_limits())


@celery_app.task(name=CONVERT_STRUCTURE)
def convert_structure(structure_id: str, lattice: str) -> None:
    s = get_settings()
    run_convert(
        get_db(),
        get_storage(),
        structure_id,
        lattice,
        s.tacoxdna_dir,
        s.converter_timeout_s,
        s.structure_limits(),
    )
