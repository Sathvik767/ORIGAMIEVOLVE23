"""Readiness checks for external dependencies."""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from pymongo import AsyncMongoClient
from redis.asyncio import Redis

ReadinessCheck = Callable[[], Awaitable[None]]


def mongo_check(client: AsyncMongoClient[Any]) -> ReadinessCheck:
    async def check() -> None:
        await client.admin.command("ping")

    return check


def redis_check(client: Redis) -> ReadinessCheck:
    async def check() -> None:
        await client.ping()

    return check


def storage_check(root: Path) -> ReadinessCheck:
    def probe() -> None:
        root.mkdir(parents=True, exist_ok=True)
        marker = root / f".ready-{uuid.uuid4().hex}"
        marker.write_bytes(b"ok")
        marker.unlink()

    async def check() -> None:
        await asyncio.to_thread(probe)

    return check


async def run_checks(checks: dict[str, ReadinessCheck], timeout_s: float) -> dict[str, str]:
    """Run all checks concurrently; never raises. Values are "ok", "timeout", or "error: <Type>"."""

    async def run(check: ReadinessCheck) -> str:
        try:
            await asyncio.wait_for(check(), timeout=timeout_s)
            return "ok"
        except TimeoutError:
            return "timeout"
        except Exception as exc:  # noqa: BLE001 - report any dependency failure
            return f"error: {type(exc).__name__}"

    names = list(checks)
    results = await asyncio.gather(*(run(checks[n]) for n in names))
    return dict(zip(names, results, strict=True))
