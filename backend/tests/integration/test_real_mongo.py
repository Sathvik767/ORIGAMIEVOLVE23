"""End to end against a real MongoDB: upload -> ingest -> batch -> optimize -> result.

Skipped unless ORIGAMI_TEST_MONGO_URI is set, e.g.

$env:ORIGAMI_TEST_MONGO_URI = "mongodb://origami:<password>@localhost:27017/?authSource=admin"
"""

import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pymongo import AsyncMongoClient, MongoClient

from origami_api.config import Settings
from origami_api.db import ensure_indexes_sync
from origami_api.main import AppDeps, create_app
from origami_api.security import generate_token, hash_token
from origami_core.storage import LocalStorage
from origami_worker.task_names import INGEST_DATASET, OPTIMIZE_DESIGN
from origami_worker.tasks.ingest import run_ingest
from origami_worker.tasks.optimize import run_optimize

URI = os.environ.get("ORIGAMI_TEST_MONGO_URI")
pytestmark = [pytest.mark.services, pytest.mark.skipif(not URI, reason="ORIGAMI_TEST_MONGO_URI not set")]
EXAMPLE = Path(__file__).resolve().parents[3] / "examples" / "synthetic_designs.csv"


async def _ok() -> None:
    return None


def test_upload_and_ingest_with_real_mongodb(tmp_path: Path) -> None:
    db_name = f"origami_test_{uuid.uuid4().hex[:8]}"
    sync_client: MongoClient[Any] = MongoClient(URI, tz_aware=True)
    sync_db = sync_client[db_name]
    try:
        ensure_indexes_sync(sync_db)
        token = generate_token()
        sync_db.api_tokens.insert_one(
            {
                "name": "t",
                "token_hash": hash_token(token),
                "created_at": datetime.now(UTC),
                "revoked_at": None,
            }
        )
        settings = Settings(env="test", storage_root=tmp_path)
        storage = LocalStorage(tmp_path)
        queued: list[tuple[str, ...]] = []

        async def dispatch(task: str, *args: object) -> None:
            queued.append((task, *map(str, args)))

        async_client: AsyncMongoClient[Any] = AsyncMongoClient(URI, tz_aware=True)
        deps = AppDeps(
            db=async_client[db_name], storage=storage, dispatch=dispatch, readiness_checks={"ok": _ok}
        )
        with TestClient(create_app(settings, deps)) as client:
            auth = {"Authorization": f"Bearer {token}"}
            r = client.post(
                "/api/v1/datasets",
                params={"name": "real", "format": "csv"},
                content=EXAMPLE.read_bytes(),
                headers=auth,
            )
            assert r.status_code == 202, r.text
            task, job_id = queued.pop()
            assert task == INGEST_DATASET
            run_ingest(sync_db, storage, settings.ingest_limits(), job_id, batch_size=2, actor="test")
            detail = client.get(f"/api/v1/datasets/{r.json()['dataset']['id']}", headers=auth).json()
            assert detail["status"] == "ready" and detail["counts"]["designs_valid"] == 3
            dup = client.post(
                "/api/v1/datasets",
                params={"name": "again", "format": "csv"},
                content=EXAMPLE.read_bytes(),
                headers=auth,
            )
            assert dup.status_code == 200 and dup.json()["duplicate"] is True

            # Batch over all designs; queued jobs run through the real worker code (M2 defaults, seed 42).
            ds_id = r.json()["dataset"]["id"]
            batch = client.post("/api/v1/batches", json={"dataset_id": ds_id}, headers=auth)
            assert batch.status_code == 202 and batch.json()["total_jobs"] == 3
            while queued:
                task, job_id, attempt = queued.pop(0)
                assert task == OPTIMIZE_DESIGN
                run_optimize(sync_db, storage, job_id, int(attempt), actor="test")
            final = client.get(f"/api/v1/batches/{batch.json()['id']}", headers=auth).json()
            assert final["status"] == "completed" and final["counts"]["completed"] == 3
            jobs = client.get(f"/api/v1/batches/{batch.json()['id']}/jobs", headers=auth).json()["items"]
            for job in jobs:
                result = client.get(f"/api/v1/jobs/{job['id']}/result", headers=auth).json()
                assert result["best_fitness"] == job["result"]["best_fitness"]
                assert len(result["fitness_history"]) == 101 and result["parameters"]["seed"] == 42
                assert result["fitness_function"]["kind"] == "computational_proxy"
    finally:
        sync_client.drop_database(db_name)
        sync_client.close()
