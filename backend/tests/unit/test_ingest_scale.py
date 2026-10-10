"""Memory stays bounded regardless of file size (run with: pytest -m slow)."""

import subprocess
import sys
import time
import tracemalloc
from pathlib import Path

import pytest

from origami_core.ingest import IngestLimits, new_report, parse_designs
from origami_core.models import DesignFormat

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "generate_synthetic.py"


@pytest.mark.slow
@pytest.mark.parametrize("fmt", [DesignFormat.CSV, DesignFormat.NDJSON])
def test_peak_memory_is_independent_of_file_size(tmp_path: Path, fmt: DesignFormat) -> None:
    path = tmp_path / f"big.{fmt.value}"
    # ~7.2 kb scaffold + 226 staples per design (M13-sized, synthetic).
    subprocess.run(  # noqa: S603
        [
            sys.executable,
            str(SCRIPT),
            "--designs",
            "3000",
            "--scaffold-length",
            "7249",
            "--format",
            fmt.value,
            "--out",
            str(path),
        ],
        check=True,
    )
    size_mb = path.stat().st_size / 1e6
    assert size_mb > 50

    limits = IngestLimits()
    report = new_report(fmt, limits)
    tracemalloc.start()
    started = time.perf_counter()
    count = 0
    with path.open("rb") as fh:
        for _ in parse_designs(fh, fmt, limits, report):
            count += 1
    elapsed = time.perf_counter() - started
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    print(
        f"\n{fmt.value}: {size_mb:.0f} MB, {count} designs, peak {peak / 1e6:.1f} MB, {elapsed:.1f}s (traced)"
    )
    assert count == 3000 and report.error_count == 0
    assert peak < 32e6, f"peak traced memory {peak / 1e6:.1f} MB"
