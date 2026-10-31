from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from origami_core.ingest import IngestLimits
from origami_core.structure import StructureLimits

MiB = 1024 * 1024


class Settings(BaseSettings):
    """Runtime configuration. Every field maps to an ORIGAMI_* environment variable."""

    # Repo-root .env first, then a local override when running from backend/.
    model_config = SettingsConfigDict(env_prefix="ORIGAMI_", env_file=("../.env", ".env"), extra="ignore")

    env: Literal["development", "test", "production"] = "development"
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "origami_evolve"
    redis_url: str = "redis://localhost:6379/0"
    storage_root: Path = Path("./data")
    # Comma-separated list of allowed browser origins.
    cors_origins: str = "http://localhost:5173"
    readiness_timeout_s: float = Field(default=2.0, gt=0)

    # Uploads
    max_upload_bytes: int = Field(default=500 * MiB, gt=0)
    upload_buffer_bytes: int = Field(default=1 * MiB, gt=0)
    max_json_body_bytes: int = Field(default=1 * MiB, gt=0)  # all non-upload request bodies

    # Ingestion (docs/PLAN.md section 6.4)
    ingest_batch_size: int = Field(default=1000, gt=0)
    ingest_max_rows: int = Field(default=5_000_000, gt=0)
    ingest_max_designs: int = Field(default=100_000, gt=0)
    ingest_max_errors: int = Field(default=10_000, ge=0)
    ingest_max_staples_per_design: int = Field(default=5_000, gt=0)
    ingest_max_candidates_per_staple: int = Field(default=16, ge=0)
    ingest_max_scaffold_length: int = Field(default=20_000, gt=0)
    ingest_max_staple_length: int = Field(default=500, gt=0)
    ingest_max_design_bytes: int = Field(default=8 * MiB, gt=0)
    ingest_max_metadata_bytes: int = Field(default=4096, gt=0)
    ingest_max_line_bytes: int = Field(default=16 * MiB, gt=0)
    ingest_allow_n: bool = False
    report_samples_per_code: int = Field(default=20, gt=0)
    report_max_issues: int = Field(default=100_000, gt=0)

    # Batch optimization (M3)
    optimize_concurrency: int = Field(default=2, gt=0)  # Celery worker processes for the optimize queue
    batch_max_designs: int = Field(default=1000, gt=0)
    job_stale_after_s: int = Field(default=300, gt=0)  # no heartbeat for this long => worker presumed lost
    job_max_stale_requeues: int = Field(default=2, ge=0)  # automatic requeues of a lost job before failing it
    reaper_interval_s: int = Field(default=60, gt=0)
    progress_interval_generations: int = Field(default=5, gt=0)
    # Upper limits for user-supplied GA settings (POST /batches); defaults stay in GAParameters.
    ga_max_population: int = Field(default=500, ge=2)
    ga_max_generations: int = Field(default=1000, ge=1)
    # method "auto" enumerates designs with at most this many combinations instead of running the GA.
    exhaustive_auto_max: int = Field(default=4096, ge=1)
    exhaustive_max_combinations: int = Field(default=1_048_576, ge=1)  # hard cap for method "exhaustive"

    # Structures (M7): oxDNA / caDNAno import
    max_structure_bytes: int = Field(default=100 * MiB, gt=0)
    structure_max_nucleotides: int = Field(default=500_000, gt=0)
    # Optional: directory with tacoxDNA's cadnano_oxDNA.py (caDNAno -> oxDNA conversion). Unset = disabled.
    tacoxdna_dir: Path | None = None
    converter_timeout_s: int = Field(default=600, gt=0)
    # Optional: path to the oxDNA executable (inside the api/worker containers). Unset = simulation disabled.
    oxdna_bin: Path | None = None
    simulation_timeout_s: int = Field(default=3600, gt=0)
    simulation_max_steps: int = Field(default=10_000_000, gt=0)

    def structure_limits(self) -> StructureLimits:
        return StructureLimits(max_nucleotides=self.structure_max_nucleotides)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def ingest_limits(self) -> IngestLimits:
        return IngestLimits(
            max_rows=self.ingest_max_rows,
            max_designs=self.ingest_max_designs,
            max_errors=self.ingest_max_errors,
            max_staples_per_design=self.ingest_max_staples_per_design,
            max_candidates_per_staple=self.ingest_max_candidates_per_staple,
            max_scaffold_length=self.ingest_max_scaffold_length,
            max_staple_length=self.ingest_max_staple_length,
            max_design_bytes=self.ingest_max_design_bytes,
            max_metadata_bytes=self.ingest_max_metadata_bytes,
            max_line_bytes=self.ingest_max_line_bytes,
            allow_n=self.ingest_allow_n,
            report_samples_per_code=self.report_samples_per_code,
            report_max_issues=self.report_max_issues,
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
