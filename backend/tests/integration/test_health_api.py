from typing import Any

from fastapi.testclient import TestClient

from origami_api.config import Settings
from origami_api.main import AppDeps, create_app
from origami_core.storage import LocalStorage

from .fakes import AsyncDatabase, new_mongomock_db


async def _ok() -> None:
    return None


async def _down() -> None:
    raise ConnectionRefusedError


async def _dispatch(task: str, job_id: str) -> None:
    return None


def _client(tmp_path: Any, **checks: Any) -> TestClient:
    deps = AppDeps(
        db=AsyncDatabase(new_mongomock_db()),
        storage=LocalStorage(tmp_path),
        dispatch=_dispatch,
        readiness_checks=checks,
    )
    return TestClient(create_app(Settings(env="test"), deps))


def test_health_is_ok_and_sets_security_headers(tmp_path: Any) -> None:
    with _client(tmp_path) as c:
        r = c.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"


def test_ready_reports_all_dependencies_ok(tmp_path: Any) -> None:
    with _client(tmp_path, mongo=_ok, redis=_ok, storage=_ok) as c:
        r = c.get("/api/v1/ready")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "checks": {"mongo": "ok", "redis": "ok", "storage": "ok"}}


def test_ready_returns_503_when_a_dependency_is_down(tmp_path: Any) -> None:
    with _client(tmp_path, mongo=_down, redis=_ok, storage=_ok) as c:
        r = c.get("/api/v1/ready")
    assert r.status_code == 503
    assert r.json()["checks"]["mongo"] == "error: ConnectionRefusedError"


def test_unknown_route_is_problem_json(tmp_path: Any) -> None:
    with _client(tmp_path) as c:
        r = c.get("/api/v1/nope")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/problem+json")
    assert r.json()["status"] == 404


def test_cors_allows_only_configured_origin(tmp_path: Any) -> None:
    with _client(tmp_path) as c:
        allowed = c.options(
            "/api/v1/health",
            headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
        )
        denied = c.options(
            "/api/v1/health",
            headers={"Origin": "http://evil.test", "Access-Control-Request-Method": "GET"},
        )
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in denied.headers


def test_unexpected_errors_and_oversized_bodies_are_problem_json(tmp_path: Any) -> None:
    deps = AppDeps(
        db=AsyncDatabase(new_mongomock_db()),
        storage=LocalStorage(tmp_path),
        dispatch=_dispatch,
        readiness_checks={},
    )
    app = create_app(Settings(env="test", max_json_body_bytes=1024), deps)

    async def boom() -> None:
        raise RuntimeError("mongodb://user:secret@db/  <- must never reach the client")

    app.add_api_route("/api/v1/boom", boom)
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/api/v1/boom")
        assert r.status_code == 500
        assert r.headers["content-type"].startswith("application/problem+json")
        assert "secret" not in r.text and r.json()["detail"] == "An unexpected error occurred."

        big = c.post(
            "/api/v1/batches", content=b"{" + b" " * 2048 + b"}", headers={"Content-Type": "application/json"}
        )
        assert big.status_code == 413 and big.headers["x-content-type-options"] == "nosniff"
        chunked = c.post(
            "/api/v1/batches", content=iter([b"{}"]), headers={"Content-Type": "application/json"}
        )
        assert chunked.status_code == 411
