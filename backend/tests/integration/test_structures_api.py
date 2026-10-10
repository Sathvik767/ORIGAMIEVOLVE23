import os
import sys
from pathlib import Path
from typing import Any

from bson import ObjectId

from ..structure_fixtures import cadnano_two_helices, oxdna_classic
from .conftest import Harness

SCAF, S1, S2 = "ACGTTGCAACGTTGCA", "TGCAACGT", "GGCCAATT"
# A synthetic design whose strands are exactly the structure's strands (s1 also has a supplied variant).
CSV = (
    "design_id,strand_id,strand_type,sequence,helix,start,end,candidate_group,source\n"
    f"d1,scaf,scaffold,{SCAF},,,,,synthetic\n"
    f"d1,s1,staple,{S1},0,0,7,,synthetic\n"
    "d1,s1v,staple_variant,TGCAACGA,,,,s1,synthetic\n"
    f"d1,s2,staple,{S2},1,8,15,,synthetic\n"
)


def design_id(h: Harness) -> str:
    ds = h.upload(CSV).json()["dataset"]
    return str(h.client.get(f"/api/v1/datasets/{ds['id']}/designs", headers=h.auth).json()["items"][0]["id"])


def put(h: Harness, path: str, body: str, **params: str) -> Any:
    return h.client.request(
        "PUT" if path.endswith("configuration") else "POST",
        f"/api/v1{path}",
        params=params,
        content=body.encode(),
        headers=h.auth,
    )


def test_oxdna_import_validates_maps_and_serves_coordinates(harness: Harness) -> None:
    did = design_id(harness)
    top, conf = oxdna_classic([SCAF, S1, S2])
    r = put(harness, "/structures", top, name="two-strand test", format="oxdna", design_id=did)
    assert r.status_code == 202 and r.json()["status"] == "awaiting_configuration"
    sid = r.json()["id"]
    assert harness.client.get(f"/api/v1/structures/{sid}/geometry", headers=harness.auth).status_code == 404

    r = put(harness, f"/structures/{sid}/configuration", conf)
    assert r.status_code == 202
    s = harness.client.get(f"/api/v1/structures/{sid}", headers=harness.auth).json()
    assert s["status"] == "ready" and s["has_coordinates"] is True
    assert s["summary"]["nucleotides"] == 32 and s["summary"]["strands"] == 3
    assert s["mapping"]["status"] == "verified" and s["mapping"]["staples"] == {"s1": 1, "s2": 2}

    g = harness.client.get(f"/api/v1/structures/{sid}/geometry", headers=harness.auth).json()
    assert g["kind"] == "molecular" and len(g["positions"]) == 96
    assert [st["role"] for st in g["strands"]] == ["scaffold", "staple", "staple"]
    listed = harness.client.get("/api/v1/structures", params={"design_id": did}, headers=harness.auth).json()
    assert [x["id"] for x in listed["items"]] == [sid]

    # Annotate with an optimization job of the same design: only verified staples get variant info.
    batch = harness.client.post(
        "/api/v1/batches",
        json={"dataset_id": str(harness.db.designs.find_one()["dataset_id"])},
        headers=harness.auth,
    ).json()
    job = harness.db.jobs.find_one({"batch_id": ObjectId(batch["id"])})
    assert job["status"] == "completed"
    ga = harness.client.get(
        f"/api/v1/structures/{sid}/geometry", params={"job_id": str(job["_id"])}, headers=harness.auth
    ).json()
    s1 = next(st for st in ga["strands"] if st["design_strand_id"] == "s1")
    assert set(s1["variant"]) == {"choice", "is_original", "length_compatible"}
    assert s1["variant"]["length_compatible"] is True
    assert (
        next(st for st in ga["strands"] if st["design_strand_id"] == "s2")["variant"] is None
    )  # no variants


def test_invalid_files_auth_and_cadnano_topology_only(harness: Harness, tmp_path: Path) -> None:
    assert harness.client.get("/api/v1/structures").status_code == 401
    r = harness.client.post("/api/v1/structures", params={"name": "x", "format": "oxdna"}, content=b"12 2\n")
    assert r.status_code == 401

    assert put(harness, "/structures", "{not a topology", name="bad", format="oxdna").status_code == 415
    top, conf = oxdna_classic(["ACGTAC", "GGTT"])
    sid = put(harness, "/structures", top, name="bad conf", format="oxdna").json()["id"]
    put(harness, f"/structures/{sid}/configuration", conf.replace("0 1 0 0 0 0 1", "0 3 0 0 0 0 1", 1))
    s = harness.client.get(f"/api/v1/structures/{sid}", headers=harness.auth).json()
    assert s["status"] == "invalid" and s["has_coordinates"] is False
    assert {i["code"] for i in s["issues"]} == {"E_CONF_ORIENTATION"} and s["issues"][0]["location"]

    c = put(harness, "/structures", cadnano_two_helices(32), name="cadnano test", format="cadnano").json()
    s = harness.client.get(f"/api/v1/structures/{c['id']}", headers=harness.auth).json()
    assert s["status"] == "topology_only" and s["has_coordinates"] is False
    assert s["summary"]["helices"] == 2 and s["summary"]["staple_crossovers"] == 1
    assert (
        harness.client.get(f"/api/v1/structures/{c['id']}/geometry", headers=harness.auth).status_code == 404
    )
    r = harness.client.post(
        f"/api/v1/structures/{c['id']}/convert", params={"lattice": "square"}, headers=harness.auth
    )
    assert r.status_code == 503 and "ORIGAMI_TACOXDNA_DIR" in r.json()["detail"]


def test_cadnano_conversion_runs_the_configured_converter_with_the_real_scaffold(
    harness: Harness, tmp_path: Path
) -> None:
    """Exercises the adapter with a stand-in converter script (not tacoxDNA itself): it records its
    arguments and writes oxDNA files, which must then pass the same validation as a direct upload."""
    top, conf = oxdna_classic([SCAF, S1, S2])
    tool = tmp_path / "tacoxdna"
    tool.mkdir()
    (tool / "cadnano_oxDNA.py").write_text(
        "import sys, pathlib\n"
        "src, lattice, seq = sys.argv[1:4]\n"
        # Fail unless given the user-stated lattice and the design's real scaffold sequence.
        f"if lattice != 'sq' or pathlib.Path(seq).read_text() != {SCAF!r}: sys.exit(3)\n"
        f"pathlib.Path(src + '.top').write_text({top!r})\n"
        f"pathlib.Path(src + '.oxdna').write_text({conf!r})\n"
    )
    harness.settings.tacoxdna_dir = tool
    did = design_id(harness)
    c = put(
        harness, "/structures", cadnano_two_helices(32), name="convert test", format="cadnano", design_id=did
    ).json()
    r = harness.client.post(
        f"/api/v1/structures/{c['id']}/convert", params={"lattice": "square"}, headers=harness.auth
    )
    assert r.status_code == 202
    s = harness.client.get(f"/api/v1/structures/{c['id']}", headers=harness.auth).json()
    assert s["status"] == "ready" and s["format"] == "oxdna"
    assert s["conversion"]["tool"] == "tacoxDNA cadnano_oxDNA.py" and s["conversion"]["lattice"] == "square"
    assert s["conversion"]["sequence_source"] == "linked design scaffold"
    assert s["mapping"]["status"] == "verified"


def test_simulation_needs_oxdna_and_creates_a_separate_simulated_structure(
    harness: Harness, tmp_path: Path
) -> None:
    top, conf = oxdna_classic([SCAF, S1, S2])
    sid = put(harness, "/structures", top, name="relax test", format="oxdna").json()["id"]
    put(harness, f"/structures/{sid}/configuration", conf)
    src = harness.client.get(f"/api/v1/structures/{sid}", headers=harness.auth).json()
    assert src["origin"] == "imported" and "W_NONHELICAL_GEOMETRY" in {i["code"] for i in src["issues"]}

    r = harness.client.post(f"/api/v1/structures/{sid}/simulate", headers=harness.auth)
    assert r.status_code == 503 and "ORIGAMI_OXDNA_BIN" in r.json()["detail"]

    # Stand-in executable (NOT oxDNA): checks the input file it is given, then copies the input configuration.
    tool = tmp_path / "fake_oxdna.py"
    tool.write_text(
        "import pathlib, shutil, sys\n"
        "text = pathlib.Path(sys.argv[1]).read_text()\n"
        "required = ['sim_type = MC', 'steps = 500', 'interaction_type = DNA2', 'max_backbone_force = 5']\n"
        "if not all(k in text for k in required): sys.exit(4)\n"
        "shutil.copy('initial.dat', 'last_conf.dat')\n"
        "pathlib.Path('energy.dat').write_text('500 -1.0 0.0 -1.0\\n')\n"
    )
    if os.name == "nt":
        launcher = tmp_path / "fake_oxdna.cmd"
        launcher.write_text(f'@"{sys.executable}" "{tool}" %*\n')
    else:
        launcher = tmp_path / "fake_oxdna.sh"
        launcher.write_text(f'#!/bin/sh\n"{sys.executable}" "{tool}" "$@"\n')
        launcher.chmod(0o755)
    harness.settings.oxdna_bin = launcher
    r = harness.client.post(
        f"/api/v1/structures/{sid}/simulate", params={"protocol": "relax", "steps": 500}, headers=harness.auth
    )
    assert r.status_code == 202 and r.json()["id"] != sid and r.json()["parent_id"] == sid
    child = harness.client.get(f"/api/v1/structures/{r.json()['id']}", headers=harness.auth).json()
    assert child["status"] == "ready" and child["origin"] == "simulated", child
    assert child["simulation"]["protocol"] == "relax" and child["simulation"]["steps"] == 500
    assert child["simulation"]["last_energy_line"] == "500 -1.0 0.0 -1.0"
    assert (
        harness.client.get(f"/api/v1/structures/{sid}", headers=harness.auth).json()["origin"] == "imported"
    )
