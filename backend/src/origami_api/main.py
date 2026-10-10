import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pymongo import AsyncMongoClient
from redis.asyncio import Redis
from starlette.middleware.base import RequestResponseEndpoint

from origami_api.config import Settings, get_settings
from origami_api.db import ensure_indexes_async
from origami_api.errors import install_error_handlers, problem
from origami_api.health import ReadinessCheck, mongo_check, redis_check, storage_check
from origami_api.routers import batches, datasets, designs, health, structures
from origami_api.services.dispatch import Dispatch, celery_dispatch
from origami_core import __version__
from origami_core.storage import LocalStorage, StorageBackend

log = logging.getLogger(__name__)
API_PREFIX = "/api/v1"

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    # API responses carry user data behind a bearer token: never cache them.
    "Cache-Control": "no-store",
}
# JSON-only API: nothing may be loaded or framed. The Swagger UI page loads its own assets, so it is exempt.
API_CSP = "default-src 'none'; frame-ancestors 'none'"
UPLOAD_PATH = f"{API_PREFIX}/datasets"  # streams its body with its own byte limit
STRUCTURES_PATH = f"{API_PREFIX}/structures"


def _is_streamed_upload(method: str, path: str) -> bool:
    """Endpoints that stream raw files to storage with their own byte limits."""
    if method == "POST" and path in (UPLOAD_PATH, STRUCTURES_PATH):
        return True
    return method == "PUT" and path.startswith(STRUCTURES_PATH + "/") and path.endswith("/configuration")


@dataclass
class AppDeps:
    """Everything the API talks to. Tests supply fakes; production builds real clients in the lifespan."""

    db: Any
    storage: StorageBackend
    dispatch: Dispatch
    readiness_checks: dict[str, ReadinessCheck]


def _install_deps(app: FastAPI, deps: AppDeps) -> None:
    app.state.db = deps.db
    app.state.storage = deps.storage
    app.state.dispatch = deps.dispatch
    app.state.readiness_checks = deps.readiness_checks


def create_app(settings: Settings | None = None, deps: AppDeps | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if deps is not None:
            _install_deps(app, deps)
            yield
            return
        from origami_worker.celery_app import celery_app

        # Neither client connects until first use, so startup never blocks on dependencies.
        mongo: AsyncMongoClient[Any] = AsyncMongoClient(
            settings.mongo_uri, serverSelectionTimeoutMS=2000, tz_aware=True
        )
        redis = Redis.from_url(settings.redis_url, socket_connect_timeout=2)
        db = mongo[settings.mongo_db]
        _install_deps(
            app,
            AppDeps(
                db=db,
                storage=LocalStorage(settings.storage_root),
                dispatch=celery_dispatch(celery_app),
                readiness_checks={
                    "mongo": mongo_check(mongo),
                    "redis": redis_check(redis),
                    "storage": storage_check(settings.storage_root),
                },
            ),
        )
        try:
            await ensure_indexes_async(db)
        except Exception as exc:  # noqa: BLE001 - API still starts; /ready reports the outage
            log.warning("could not ensure MongoDB indexes at startup: %s", exc)
        try:
            yield
        finally:
            await redis.aclose()
            await mongo.close()

    app = FastAPI(
        title="OrigamiEvolve API",
        version=__version__,
        description="DNA origami dataset management and GA optimization orchestration. "
        "Fitness values are computational proxies, not experimental validation.",
        lifespan=lifespan,
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        openapi_url=f"{API_PREFIX}/openapi.json",
    )
    app.state.settings = settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )

    @app.middleware("http")
    async def limit_json_body(request: Request, call_next: RequestResponseEndpoint) -> Response:
        """Bound non-upload request bodies; FastAPI would otherwise read any size into memory."""
        if request.method in ("POST", "PUT", "PATCH") and not _is_streamed_upload(
            request.method, request.url.path
        ):
            length = request.headers.get("content-length")
            if length is None and request.headers.get("transfer-encoding"):
                return problem(411, "Length Required", "Send a Content-Length header with request bodies.")
            if length is not None and (not length.isdigit() or int(length) > settings.max_json_body_bytes):
                return problem(
                    413, "Content Too Large", f"Request body exceeds {settings.max_json_body_bytes} bytes."
                )
        return await call_next(request)

    # Registered last so it runs outermost and also decorates responses produced by inner middleware.
    @app.middleware("http")
    async def security_headers(request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if request.url.path != f"{API_PREFIX}/docs":
            response.headers.setdefault("Content-Security-Policy", API_CSP)
        return response

    install_error_handlers(app)
    for module in (health, datasets, designs, batches, structures):
        app.include_router(module.router, prefix=API_PREFIX)
    app.include_router(batches.jobs_router, prefix=API_PREFIX)
    app.include_router(batches.fitness_router, prefix=API_PREFIX)
    return app


app = create_app()
