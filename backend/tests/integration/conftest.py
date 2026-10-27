from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from origami_api.config import Settings
from origami_api.db import ensure_indexes_sync
from origami_api.main import AppDeps, create_app
from origami_api.security import generate_token, hash_token
from origami_core.storage import LocalStorage
from origami_worker.task_names import (
    CONVERT_STRUCTURE,
    INGEST_DATASET,
    OPTIMIZE_DESIGN,
    SIMULATE_STRUCTURE,
    VALIDATE_STRUCTURE,
)
from origami_worker.tasks.ingest import run_ingest
from origami_worker.tasks.optimize import run_optimize
from origami_worker.tasks.structure import run_convert, run_simulate, run_validate

from .fakes import AsyncDatabase, new_mongomock_db


async def _ok() -> None:
    return None


@dataclass
class Harness:
    client: TestClient
    db: Any  # sync mongomock db, for assertions
    storage: LocalStorage
    settings: Settings
    token: str
    dispatched: list[tuple[Any, ...]] = field(default_factory=list)
    run_worker: bool = True
    broker_down: bool = False

    @property
    def auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def upload(self, data: bytes | str, fmt: str = "csv", name: str = "test", **params: str) -> Any:
        body = data.encode() if isinstance(data, str) else data
        return self.client.post(
            "/api/v1/datasets",
            params={"name": name, "format": fmt, **params},
            content=body,
            headers=self.auth,
        )

    def run_pending(self) -> None:
        """Run dispatched-but-not-executed tasks through the real worker code."""
        pending, self.dispatched = self.dispatched, []
        for task, *args in pending:
            if task == INGEST_DATASET:
                run_ingest(
                    self.db,
                    self.storage,
                    self.settings.ingest_limits(),
                    args[0],
                    batch_size=2,
                    actor="test-worker",
                )
            elif task == OPTIMIZE_DESIGN:
                run_optimize(
                    self.db,
                    self.storage,
                    args[0],
                    args[1],
                    actor="test-worker",
                    auto_exhaustive_max=self.settings.exhaustive_auto_max,
                    exhaustive_max=self.settings.exhaustive_max_combinations,
                )
            elif task == VALIDATE_STRUCTURE:
                run_validate(self.db, self.storage, args[0], self.settings.structure_limits())
            elif task == CONVERT_STRUCTURE:
                s = self.settings
                run_convert(self.db, self.storage, args[0], args[1], s.tacoxdna_dir, 30, s.structure_limits())
            elif task == SIMULATE_STRUCTURE:
                s = self.settings
                run_simulate(self.db, self.storage, args[0], s.oxdna_bin, 30, s.structure_limits())


@pytest.fixture
def harness(tmp_path: Path) -> Iterator[Harness]:
    settings = Settings(
        env="test", storage_root=tmp_path / "data", max_upload_bytes=64 * 1024, upload_buffer_bytes=1024
    )
    sync_db = new_mongomock_db()
    ensure_indexes_sync(sync_db)
    token = generate_token()
    sync_db.api_tokens.insert_one(
        {
            "name": "tester",
            "token_hash": hash_token(token),
            "created_at": datetime.now(UTC),
            "revoked_at": None,
        }
    )
    storage = LocalStorage(settings.storage_root)
    h: Harness

    async def dispatch(task: str, *args: Any) -> None:
        if h.broker_down:
            raise ConnectionError("broker unreachable")
        h.dispatched.append((task, *args))
        if h.run_worker:
            h.run_pending()

    deps = AppDeps(
        db=AsyncDatabase(sync_db),
        storage=storage,
        dispatch=dispatch,
        readiness_checks={"mongo": _ok, "redis": _ok, "storage": _ok},
    )
    with TestClient(create_app(settings, deps)) as client:
        h = Harness(client=client, db=sync_db, storage=storage, settings=settings, token=token)
        yield h
