"""Streaming, validating readers for design datasets. See docs/input-formats.md."""

import codecs
from collections.abc import Iterator
from typing import BinaryIO

from origami_core.ingest.csv_reader import REQUIRED_COLUMNS, read_csv
from origami_core.ingest.json_readers import UTF8_BOM, read_json_array, read_ndjson
from origami_core.ingest.limits import IngestLimits
from origami_core.ingest.report import IngestAborted, Issue, ValidationReport
from origami_core.models import Design, DesignFormat

__all__ = [
    "IngestAborted",
    "IngestLimits",
    "Issue",
    "ValidationReport",
    "new_report",
    "parse_designs",
    "sniff",
]


def new_report(fmt: DesignFormat, limits: IngestLimits) -> ValidationReport:
    return ValidationReport(limits, location_kind="index" if fmt is DesignFormat.JSON else "line")


def parse_designs(
    stream: BinaryIO, fmt: DesignFormat, limits: IngestLimits, report: ValidationReport
) -> Iterator[Design]:
    """Yield valid designs one at a time; problems go to `report`. Raises IngestAborted on fatal errors."""
    readers = {
        DesignFormat.CSV: read_csv,
        DesignFormat.NDJSON: read_ndjson,
        DesignFormat.JSON: read_json_array,
    }
    return readers[fmt](stream, limits, report)


def sniff(prefix: bytes, fmt: DesignFormat) -> str | None:
    """Cheap check on the first bytes of an upload. Returns a problem description, or None if plausible."""
    if prefix.startswith(UTF8_BOM):
        prefix = prefix[len(UTF8_BOM) :]
    try:
        text = codecs.getincrementaldecoder("utf-8")().decode(prefix, final=False)
    except UnicodeDecodeError:
        return "File is not UTF-8 text"
    stripped = text.lstrip()
    if not stripped:
        return "File is empty"
    if fmt is DesignFormat.CSV:
        header = stripped.splitlines()[0] if "\n" in stripped else stripped
        if REQUIRED_COLUMNS[0] not in header:
            return f"CSV header must include {', '.join(REQUIRED_COLUMNS)}"
    elif fmt is DesignFormat.JSON and not stripped.startswith("["):
        return "JSON files must contain a top-level array of designs (use NDJSON for one design per line)"
    elif fmt is DesignFormat.NDJSON and not stripped.startswith("{"):
        return "NDJSON files must contain one JSON object per line"
    return None
