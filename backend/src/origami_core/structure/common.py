from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class StructureIssue:
    code: str
    message: str
    severity: Literal["error", "warning"] = "error"
    location: str | None = None  # e.g. "topology line 12", "vstrand 3 scaf[40]"


class StructureError(ValueError):
    """The file cannot be used. `issues` holds every problem found (up to the cap)."""

    def __init__(self, issues: list[StructureIssue]) -> None:
        super().__init__("; ".join(i.message for i in issues[:3]))
        self.issues = issues


@dataclass(frozen=True)
class StructureLimits:
    max_nucleotides: int = 500_000
    max_strands: int = 50_000
    max_issues: int = 200
    unit_vector_tolerance: float = 1e-2


@dataclass
class IssueCollector:
    limits: StructureLimits
    issues: list[StructureIssue] = field(default_factory=list)

    def add(
        self,
        code: str,
        message: str,
        location: str | None = None,
        severity: Literal["error", "warning"] = "error",
    ) -> None:
        if len(self.issues) < self.limits.max_issues:
            self.issues.append(StructureIssue(code, message, severity, location))

    @property
    def errors(self) -> list[StructureIssue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[StructureIssue]:
        return [i for i in self.issues if i.severity == "warning"]

    def raise_if_errors(self) -> None:
        if self.errors:
            raise StructureError(self.errors)
