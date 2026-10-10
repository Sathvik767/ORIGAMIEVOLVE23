"""Streaming readers for NDJSON (one design per line, preferred) and JSON arrays of designs."""

import json
from collections.abc import Iterator
from typing import Any, BinaryIO

import ijson
from pydantic import BaseModel, ConfigDict, ValidationError

from origami_core.ingest.common import finish_design, schema_issues
from origami_core.ingest.limits import IngestLimits
from origami_core.ingest.report import Issue, ValidationReport
from origami_core.ingest.validation import normalize_sequence
from origami_core.models import Design, Measurement, MetadataValue, Strand

UTF8_BOM = b"\xef\xbb\xbf"


class _StrandIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    sequence: str
    helix: int | None = None
    start: int | None = None
    end: int | None = None
    candidates: list[str] = []


class _ScaffoldIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    sequence: str


class _RecordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    design_id: str
    name: str | None = None
    scaffold: _ScaffoldIn | None = None
    staples: list[_StrandIn]
    metadata: dict[str, MetadataValue] = {}
    measurements: list[Measurement] = []


def _to_design(rec: _RecordIn) -> Design:
    return Design(
        external_id=rec.design_id,
        name=rec.name,
        scaffold=Strand(id=rec.scaffold.id, sequence=normalize_sequence(rec.scaffold.sequence))
        if rec.scaffold
        else None,
        staples=tuple(
            Strand(
                id=s.id,
                sequence=normalize_sequence(s.sequence),
                helix=s.helix,
                start=s.start,
                end=s.end,
                candidates=tuple(normalize_sequence(c) for c in s.candidates),
            )
            for s in rec.staples
        ),
        metadata=rec.metadata,
        measurements=tuple(rec.measurements),
    )


class _RecordHandler:
    def __init__(self, limits: IngestLimits, report: ValidationReport) -> None:
        self.limits, self.report = limits, report
        self.seen: set[str] = set()

    def count_record(self, loc: int) -> None:
        self.report.records_read += 1
        if self.report.records_read > self.limits.max_rows:
            self.report.abort(Issue("E_ROW_LIMIT", f"More than {self.limits.max_rows} records", location=loc))

    def reject(self, issue: Issue) -> None:
        self.report.add(issue)
        self.report.designs_invalid += 1

    def handle(self, obj: Any, loc: int) -> Design | None:
        if not isinstance(obj, dict):
            self.reject(Issue("E_SCHEMA", "Each record must be a JSON object", location=loc))
            return None
        raw_id = obj.get("design_id")
        did = raw_id if isinstance(raw_id, str) else None
        try:
            rec = _RecordIn.model_validate(obj)
        except ValidationError as exc:
            for issue in schema_issues(exc, loc, did):
                self.report.add(issue)
            self.report.designs_invalid += 1
            return None
        if rec.design_id in self.seen:
            self.reject(
                Issue(
                    "E_DUPLICATE_DESIGN",
                    f"design_id {rec.design_id!r} appears more than once",
                    location=loc,
                    design_id=rec.design_id,
                )
            )
            return None
        self.seen.add(rec.design_id)
        if len(self.seen) > self.limits.max_designs:
            self.report.abort(
                Issue("E_DESIGN_LIMIT", f"More than {self.limits.max_designs} designs", location=loc)
            )
        return finish_design(lambda: _to_design(rec), rec.design_id, loc, self.limits, self.report)


def read_ndjson(stream: BinaryIO, limits: IngestLimits, report: ValidationReport) -> Iterator[Design]:
    handler = _RecordHandler(limits, report)
    line_no = 0
    while line := stream.readline(limits.max_line_bytes + 1):
        line_no += 1
        if len(line) > limits.max_line_bytes and not line.endswith(b"\n"):
            while (rest := stream.readline(1 << 20)) and not rest.endswith(b"\n"):
                pass
            handler.count_record(line_no)
            handler.reject(
                Issue("E_LINE_TOO_LONG", f"Line exceeds {limits.max_line_bytes} bytes", location=line_no)
            )
            continue
        if line_no == 1 and line.startswith(UTF8_BOM):
            line = line[len(UTF8_BOM) :]
        if not line.strip():
            continue
        handler.count_record(line_no)
        try:
            obj = json.loads(line.decode("utf-8"))
        except UnicodeDecodeError:
            handler.reject(Issue("E_ENCODING", "Line is not valid UTF-8", location=line_no))
            continue
        except json.JSONDecodeError as exc:
            handler.reject(Issue("E_JSON", f"Invalid JSON: {exc.msg} (column {exc.colno})", location=line_no))
            continue
        if (design := handler.handle(obj, line_no)) is not None:
            yield design


def read_json_array(stream: BinaryIO, limits: IngestLimits, report: ValidationReport) -> Iterator[Design]:
    if stream.read(len(UTF8_BOM)) != UTF8_BOM:
        stream.seek(0)
    handler = _RecordHandler(limits, report)
    index = -1
    try:
        for index, obj in enumerate(ijson.items(stream, "item", use_float=True)):
            handler.count_record(index)
            if (design := handler.handle(obj, index)) is not None:
                yield design
    except ijson.JSONError as exc:
        report.abort(Issue("E_JSON", f"Malformed JSON after element {index}: {exc}", location=index + 1))
