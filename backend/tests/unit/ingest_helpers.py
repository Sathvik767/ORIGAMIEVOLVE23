import io

from origami_core.ingest import IngestLimits, ValidationReport, new_report, parse_designs
from origami_core.models import Design, DesignFormat

HEADER = "design_id,strand_id,strand_type,sequence,helix,start,end,candidate_group"
SCAFFOLD = "ACGT" * 16  # 64 nt


def parse(
    data: str | bytes, fmt: DesignFormat = DesignFormat.CSV, limits: IngestLimits | None = None
) -> tuple[list[Design], ValidationReport]:
    limits = limits or IngestLimits()
    report = new_report(fmt, limits)
    raw = data.encode() if isinstance(data, str) else data
    return list(parse_designs(io.BytesIO(raw), fmt, limits, report)), report


def csv_of(*rows: str, header: str = HEADER) -> str:
    return "\n".join([header, *rows]) + "\n"
