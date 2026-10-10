from dataclasses import dataclass


@dataclass(frozen=True)
class IngestLimits:
    """Bounds applied while parsing. Built from Settings in the API/worker; defaults suit tests."""

    max_rows: int = 5_000_000
    max_designs: int = 100_000
    max_errors: int = 10_000
    max_staples_per_design: int = 5_000
    max_candidates_per_staple: int = 16
    max_scaffold_length: int = 20_000
    max_staple_length: int = 500
    max_design_bytes: int = 8 * 1024 * 1024
    max_metadata_bytes: int = 4096
    max_line_bytes: int = 16 * 1024 * 1024
    allow_n: bool = False
    report_samples_per_code: int = 20
    report_max_issues: int = 100_000
