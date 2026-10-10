import asyncio
from pathlib import Path

from origami_api.health import run_checks, storage_check


async def _ok() -> None:
    return None


async def _boom() -> None:
    raise ConnectionError("down")


async def _slow() -> None:
    await asyncio.sleep(5)


async def test_run_checks_reports_each_outcome_without_raising() -> None:
    results = await run_checks({"a": _ok, "b": _boom, "c": _slow}, timeout_s=0.05)
    assert results == {"a": "ok", "b": "error: ConnectionError", "c": "timeout"}


async def test_storage_check_creates_root_and_leaves_no_marker(tmp_path: Path) -> None:
    root = tmp_path / "nested" / "data"
    await storage_check(root)()
    assert root.is_dir()
    assert list(root.iterdir()) == []
