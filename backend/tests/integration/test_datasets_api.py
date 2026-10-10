import json
from pathlib import Path

import pytest

from .conftest import Harness

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"
GOOD_CSV = (
    "design_id,strand_id,strand_type,sequence,helix,start,end,candidate_group\n"
    f"d1,scaf,scaffold,{'ACGT' * 16},,,,\n"
    "d1,s1,staple,ACGTACGT,0,0,7,\n"
    "d1,s1v,staple_variant,ACGTACGA,,,,s1\n"
    "d2,s1,staple,TTTT,,,,\n"
)


def test_requires_bearer_token(harness: Harness) -> None:
    r = harness.client.get("/api/v1/datasets")
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"
    assert r.headers["content-type"].startswith("application/problem+json")
    bad = harness.client.get("/api/v1/datasets", headers={"Authorization": "Bearer oe_wrong"})
    assert bad.status_code == 401


def test_revoked_token_is_rejected(harness: Harness) -> None:
    harness.db.api_tokens.update_many({}, {"$set": {"revoked_at": "now"}})
    assert harness.client.get("/api/v1/datasets", headers=harness.auth).status_code == 401


@pytest.mark.parametrize("fmt", ["csv", "ndjson", "json"])
def test_upload_ingests_example_files(harness: Harness, fmt: str) -> None:
    data = (EXAMPLES / f"synthetic_designs.{fmt}").read_bytes()
    r = harness.upload(data, fmt, name=f"Example {fmt}", filename=f"C:\\Users\\x\\synthetic.{fmt}")
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["duplicate"] is False
    ds = body["dataset"]
    assert ds["original_filename"] == f"synthetic.{fmt}"
    assert ds["size_bytes"] == len(data)

    detail = harness.client.get(f"/api/v1/datasets/{ds['id']}", headers=harness.auth).json()
    assert detail["status"] == "ready"
    assert detail["counts"]["designs_valid"] == 3
    assert detail["ingest_job"]["status"] == "completed"

    page = harness.client.get(f"/api/v1/datasets/{ds['id']}/designs", headers=harness.auth).json()
    assert [d["external_id"] for d in page["items"]] == [
        "synthetic_00000",
        "synthetic_00001",
        "synthetic_00002",
    ]
    assert page["items"][0]["staple_count"] == 8 and page["items"][0]["candidate_count"] == 3

    design = harness.client.get(f"/api/v1/designs/{page['items'][0]['id']}", headers=harness.auth).json()
    assert len(design["staples"]) == 8
    assert design["measurements"] == []


def test_partial_errors_produce_report_and_ready_with_errors(harness: Harness) -> None:
    data = GOOD_CSV + "d3,s1,staple,ACGU,,,,\nd3,s2,staple,ACGT,x,,,\n"
    ds = harness.upload(data).json()["dataset"]
    detail = harness.client.get(f"/api/v1/datasets/{ds['id']}", headers=harness.auth).json()
    assert detail["status"] == "ready_with_errors"
    assert detail["counts"] == {
        "records_read": 6,
        "designs_valid": 2,
        "designs_invalid": 1,
        "error_count": 2,
        "warning_count": 2,
    }

    report = harness.client.get(f"/api/v1/datasets/{ds['id']}/report", headers=harness.auth).json()
    assert report["errors_by_code"] == {"E_ALPHABET": 1, "E_INTEGER": 1}
    assert report["warnings_by_code"] == {"W_NO_SCAFFOLD": 2}
    assert report["samples"]["E_ALPHABET"][0]["location"] == 6

    full = harness.client.get(f"/api/v1/datasets/{ds['id']}/report/download", headers=harness.auth)
    assert full.status_code == 200
    assert "attachment" in full.headers["content-disposition"]
    assert len(json.loads(full.content)["issues"]) == 4
    # Only valid designs are stored.
    assert harness.db.designs.count_documents({}) == 2


def test_fatal_errors_fail_dataset_and_store_no_designs(harness: Harness) -> None:
    data = "design_id,strand_id,strand_type,sequence\n" + "".join(f"d{i},s,staple,ACGU\n" for i in range(3))
    harness.settings.ingest_max_errors = 1
    ds = harness.upload(data).json()["dataset"]
    detail = harness.client.get(f"/api/v1/datasets/{ds['id']}", headers=harness.auth).json()
    assert detail["status"] == "failed"
    assert detail["ingest_job"]["error"]["code"] == "E_TOO_MANY_ERRORS"
    assert harness.db.designs.count_documents({}) == 0


def test_no_valid_designs_fails(harness: Harness) -> None:
    ds = harness.upload("design_id,strand_id,strand_type,sequence\nd1,s,staple,XYZ\n").json()["dataset"]
    detail = harness.client.get(f"/api/v1/datasets/{ds['id']}", headers=harness.auth).json()
    assert detail["status"] == "failed"
    assert detail["ingest_job"]["error"]["code"] == "E_NO_VALID_DESIGNS"


def test_duplicate_upload_returns_existing_dataset(harness: Harness) -> None:
    first = harness.upload(GOOD_CSV)
    second = harness.upload(GOOD_CSV, name="again")
    assert first.status_code == 202 and second.status_code == 200
    assert second.json()["duplicate"] is True
    assert second.json()["dataset"]["id"] == first.json()["dataset"]["id"]
    assert harness.db.datasets.count_documents({}) == 1
    assert list((harness.settings.storage_root / "tmp").glob("*")) == []


def test_reupload_allowed_after_delete(harness: Harness) -> None:
    ds_id = harness.upload(GOOD_CSV).json()["dataset"]["id"]
    assert harness.client.delete(f"/api/v1/datasets/{ds_id}", headers=harness.auth).status_code == 204
    assert harness.client.get(f"/api/v1/datasets/{ds_id}", headers=harness.auth).status_code == 404
    again = harness.upload(GOOD_CSV)
    assert again.status_code == 202 and again.json()["dataset"]["id"] != ds_id


@pytest.mark.parametrize(
    ("data", "fmt", "status"),
    [
        (b"", "csv", 422),
        (b"name,sequence\nx,ACGT\n", "csv", 415),
        (b'{"design_id": "d1"}\n', "json", 415),
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 100, "ndjson", 415),
    ],
)
def test_rejects_empty_or_mismatched_content(harness: Harness, data: bytes, fmt: str, status: int) -> None:
    r = harness.upload(data, fmt)
    assert r.status_code == status
    assert harness.db.datasets.count_documents({}) == 0
    assert list((harness.settings.storage_root / "tmp").glob("*")) == []


def test_rejects_oversized_upload_while_streaming(harness: Harness) -> None:
    big = GOOD_CSV + "d9,s1,staple,ACGT,,,,\n" * 5000  # > 64 KiB test limit

    def chunks():  # no Content-Length: limit must be enforced on the stream itself
        for i in range(0, len(big), 4096):
            yield big[i : i + 4096].encode()

    r = harness.client.post(
        "/api/v1/datasets", params={"name": "big", "format": "csv"}, content=chunks(), headers=harness.auth
    )
    assert r.status_code == 413
    assert list((harness.settings.storage_root / "tmp").glob("*")) == []
    assert harness.db.datasets.count_documents({}) == 0


def test_rejects_declared_oversized_upload_early(harness: Harness) -> None:
    r = harness.client.post(
        "/api/v1/datasets",
        params={"name": "big", "format": "csv"},
        content=b"x" * (harness.settings.max_upload_bytes + 1),
        headers=harness.auth,
    )
    assert r.status_code == 413


def test_validates_query_parameters(harness: Harness) -> None:
    r = harness.client.post(
        "/api/v1/datasets", params={"name": "", "format": "xlsx"}, content=b"a", headers=harness.auth
    )
    assert r.status_code == 422
    fields = {e["loc"][-1] for e in r.json()["errors"]}
    assert fields == {"name", "format"}


def test_broker_outage_fails_job_visibly_and_reingest_recovers(harness: Harness) -> None:
    harness.broker_down = True
    ds = harness.upload(GOOD_CSV).json()["dataset"]
    assert ds["status"] == "failed"
    assert ds["ingest_job"]["error"]["code"] == "DISPATCH_FAILED"
    assert ds["ingest_job"]["error"]["retryable"] is True

    harness.broker_down = False
    r = harness.client.post(f"/api/v1/datasets/{ds['id']}/ingest", headers=harness.auth)
    assert r.status_code == 202
    detail = harness.client.get(f"/api/v1/datasets/{ds['id']}", headers=harness.auth).json()
    assert detail["status"] == "ready"
    assert harness.db.jobs.count_documents({"dataset_id": harness.db.datasets.find_one()["_id"]}) == 2


def test_reingest_and_delete_blocked_while_job_active(harness: Harness) -> None:
    harness.run_worker = False
    ds_id = harness.upload(GOOD_CSV).json()["dataset"]["id"]
    assert harness.client.post(f"/api/v1/datasets/{ds_id}/ingest", headers=harness.auth).status_code == 409
    assert harness.client.delete(f"/api/v1/datasets/{ds_id}", headers=harness.auth).status_code == 409
    harness.run_pending()
    assert harness.client.delete(f"/api/v1/datasets/{ds_id}", headers=harness.auth).status_code == 204


def test_reingest_replaces_designs_without_duplicates(harness: Harness) -> None:
    ds_id = harness.upload(GOOD_CSV).json()["dataset"]["id"]
    harness.client.post(f"/api/v1/datasets/{ds_id}/ingest", headers=harness.auth)
    assert harness.db.designs.count_documents({}) == 2


def test_duplicate_task_delivery_is_a_no_op(harness: Harness) -> None:
    harness.run_worker = False
    harness.upload(GOOD_CSV)
    duplicate = list(harness.dispatched)
    harness.run_pending()
    harness.dispatched = duplicate
    harness.run_pending()  # same job delivered again: claim fails, nothing changes
    assert harness.db.designs.count_documents({}) == 2
    events = [e["to"] for e in harness.db.job_events.find().sort("at", 1)]
    assert events == ["queued", "running", "completed"]


def test_list_datasets_paginates_newest_first(harness: Harness) -> None:
    ids = [
        harness.upload(GOOD_CSV + f"d{i}x,s1,staple,ACGT,,,,\n", name=f"ds{i}").json()["dataset"]["id"]
        for i in range(3)
    ]
    p1 = harness.client.get("/api/v1/datasets", params={"limit": 2}, headers=harness.auth).json()
    assert [d["id"] for d in p1["items"]] == ids[::-1][:2]
    p2 = harness.client.get(
        "/api/v1/datasets", params={"limit": 2, "cursor": p1["next_cursor"]}, headers=harness.auth
    ).json()
    assert [d["id"] for d in p2["items"]] == [ids[0]]
    assert p2["next_cursor"] is None
    ready = harness.client.get("/api/v1/datasets", params={"status": "failed"}, headers=harness.auth).json()
    assert ready["items"] == []


def test_unknown_or_malformed_ids_are_404(harness: Harness) -> None:
    for path in (
        "/api/v1/datasets/nope",
        "/api/v1/datasets/0123456789abcdef01234567",
        "/api/v1/designs/nope",
        "/api/v1/datasets/0123456789abcdef01234567/report",
    ):
        assert harness.client.get(path, headers=harness.auth).status_code == 404


def test_token_with_extra_text_gets_a_specific_401(harness: Harness) -> None:
    junk = f"Bearer {harness.token} Store this token now; it cannot be shown again."
    r = harness.client.get("/api/v1/datasets", headers={"Authorization": junk})
    assert r.status_code == 401 and r.json()["detail"].startswith("Malformed bearer token")
    assert (
        harness.client.get(
            "/api/v1/datasets", headers={"Authorization": f"Bearer  {harness.token} "}
        ).status_code
        == 200
    )
