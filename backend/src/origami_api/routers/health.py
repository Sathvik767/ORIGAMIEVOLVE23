from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from origami_api.health import run_checks

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness: the process is up. Does not touch dependencies."""
    return {"status": "ok"}


@router.get("/ready")
async def ready(request: Request) -> JSONResponse:
    """Readiness: MongoDB, Redis, and file storage are reachable."""
    settings = request.app.state.settings
    results = await run_checks(request.app.state.readiness_checks, settings.readiness_timeout_s)
    ok = all(v == "ok" for v in results.values())
    return JSONResponse(
        {"status": "ok" if ok else "unavailable", "checks": results},
        status_code=200 if ok else 503,
    )
