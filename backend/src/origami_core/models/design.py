"""Canonical in-memory representation of a DNA origami design.

These models carry *data only*. They make no claim about whether a design folds;
semantic checks (alphabet, coordinates, limits) live in origami_core.ingest.validation
so that every problem is reported with a stable error code.
"""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MetadataValue = str | int | float | bool | None


class DesignFormat(StrEnum):
    CSV = "csv"
    NDJSON = "ndjson"
    JSON = "json"


class Strand(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1, max_length=128)
    sequence: str
    helix: int | None = None
    start: int | None = None
    end: int | None = None
    # Alternative sequences supplied by the user for this staple slot. The GA (M2) only
    # chooses among these; it never invents sequences.
    candidates: tuple[str, ...] = ()


class Measurement(BaseModel):
    """A value the user imported (e.g. a gel yield). Stored verbatim, never computed."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1, max_length=128)
    value: float
    unit: str | None = Field(default=None, max_length=64)
    method: str | None = Field(default=None, max_length=256)
    source: Literal["user_import"] = "user_import"


class Design(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    external_id: str = Field(min_length=1, max_length=128)
    name: str | None = Field(default=None, max_length=256)
    scaffold: Strand | None = None
    staples: tuple[Strand, ...] = ()
    metadata: dict[str, MetadataValue] = Field(default_factory=dict)
    measurements: tuple[Measurement, ...] = ()
