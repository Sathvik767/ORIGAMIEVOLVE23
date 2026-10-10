"""Validation report accumulated while a file is parsed."""

from collections import Counter
from dataclasses import asdict, dataclass
from typing import Any, Literal, NoReturn

from origami_core.ingest.limits import IngestLimits

Severity = Literal["error", "warning"]


@dataclass(frozen=True)
class Issue:
    code: str
    message: str
    severity: Severity = "error"
    # CSV/NDJSON: 1-based physical line. JSON array: 0-based element index.
    location: int | None = None
    design_id: str | None = None
    field: str | None = None


class IngestAborted(Exception):
    """Parsing cannot continue (malformed structure, limits exceeded)."""

    def __init__(self, issue: Issue) -> None:
        super().__init__(issue.message)
        self.issue = issue


class ValidationReport:
    def __init__(self, limits: IngestLimits, location_kind: Literal["line", "index"] = "line") -> None:
        self.limits = limits
        self.location_kind = location_kind
        self.records_read = 0
        self.designs_valid = 0
        self.designs_invalid = 0
        self.errors: Counter[str] = Counter()
        self.warnings: Counter[str] = Counter()
        self.samples: dict[str, list[Issue]] = {}
        self.issues: list[Issue] = []
        self.issues_truncated = False
        self.fatal: Issue | None = None

    def add(self, issue: Issue) -> None:
        (self.errors if issue.severity == "error" else self.warnings)[issue.code] += 1
        samples = self.samples.setdefault(issue.code, [])
        if len(samples) < self.limits.report_samples_per_code:
            samples.append(issue)
        if len(self.issues) < self.limits.report_max_issues:
            self.issues.append(issue)
        else:
            self.issues_truncated = True
        if issue.severity == "error" and self.error_count > self.limits.max_errors:
            self.abort(
                Issue("E_TOO_MANY_ERRORS", f"More than {self.limits.max_errors} errors; ingestion stopped")
            )

    def abort(self, issue: Issue) -> NoReturn:
        self.fatal = issue
        raise IngestAborted(issue)

    @property
    def error_count(self) -> int:
        return sum(self.errors.values())

    @property
    def warning_count(self) -> int:
        return sum(self.warnings.values())

    def summary(self) -> dict[str, Any]:
        """Compact, JSON-serializable summary stored on the dataset document."""
        return {
            "location_kind": self.location_kind,
            "records_read": self.records_read,
            "designs_valid": self.designs_valid,
            "designs_invalid": self.designs_invalid,
            "error_count": self.error_count,
            "warning_count": self.warning_count,
            "errors_by_code": dict(self.errors),
            "warnings_by_code": dict(self.warnings),
            "samples": {code: [asdict(i) for i in items] for code, items in self.samples.items()},
            "fatal": asdict(self.fatal) if self.fatal else None,
        }

    def full(self) -> dict[str, Any]:
        return {
            **self.summary(),
            "issues": [asdict(i) for i in self.issues],
            "issues_truncated": self.issues_truncated,
        }
