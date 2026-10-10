from collections.abc import Callable

from pydantic import ValidationError

from origami_core.ingest.limits import IngestLimits
from origami_core.ingest.report import Issue, ValidationReport
from origami_core.ingest.validation import SourceLines, validate_design
from origami_core.models import Design


def schema_issues(exc: ValidationError, loc: int | None, design_id: str | None) -> list[Issue]:
    return [
        Issue(
            "E_SCHEMA",
            err["msg"],
            location=loc,
            design_id=design_id,
            field=".".join(str(p) for p in err["loc"]) or None,
        )
        for err in exc.errors()
    ]


def finish_design(
    build: Callable[[], Design],
    design_id: str | None,
    loc: int | None,
    limits: IngestLimits,
    report: ValidationReport,
    already_invalid: bool = False,
    lines: SourceLines | None = None,
) -> Design | None:
    """Build and validate one design. A design with any error is rejected as a whole:
    partially imported designs would silently misrepresent the user's data."""
    try:
        design = build()
    except ValidationError as exc:
        for issue in schema_issues(exc, loc, design_id):
            report.add(issue)
        report.designs_invalid += 1
        return None
    issues = validate_design(design, limits, loc, lines)
    for issue in issues:
        report.add(issue)
    if already_invalid or any(i.severity == "error" for i in issues):
        report.designs_invalid += 1
        return None
    report.designs_valid += 1
    return design
