import json

import pytest

from origami_core.ingest import IngestAborted, IngestLimits, sniff
from origami_core.models import DesignFormat

from .ingest_helpers import SCAFFOLD, parse

ND = DesignFormat.NDJSON
JS = DesignFormat.JSON


def record(did: str = "d1", **overrides: object) -> dict[str, object]:
    rec: dict[str, object] = {
        "design_id": did,
        "scaffold": {"id": "scaf", "sequence": SCAFFOLD},
        "staples": [{"id": "s1", "sequence": "acgt", "start": 0, "end": 3, "candidates": ["ACGA"]}],
        "metadata": {"batch": "B1", "replicate": 2},
        "measurements": [{"name": "gel_yield", "value": 0.4, "unit": "fraction", "method": "agarose gel"}],
    }
    rec.update(overrides)
    return rec


def ndjson(*records: object) -> str:
    return "".join(json.dumps(r) + "\n" for r in records)


def test_ndjson_valid_records() -> None:
    designs, report = parse(ndjson(record("d1"), record("d2")), ND)
    assert report.error_count == 0
    assert [d.external_id for d in designs] == ["d1", "d2"]
    assert designs[0].staples[0].sequence == "ACGT"
    assert designs[0].staples[0].candidates == ("ACGA",)
    assert designs[0].measurements[0].method == "agarose gel"


def test_ndjson_bad_lines_do_not_stop_parsing() -> None:
    data = (
        ndjson(record("d1")) + "{not json\n" + "[1,2]\n" + ndjson(record("d2", staples="nope"), record("d3"))
    )
    designs, report = parse(data, ND)
    assert [d.external_id for d in designs] == ["d1", "d3"]
    assert report.errors["E_JSON"] == 1
    assert report.errors["E_SCHEMA"] >= 2
    assert report.samples["E_JSON"][0].location == 2
    assert report.designs_invalid == 3


def test_ndjson_unknown_fields_are_rejected() -> None:
    _, report = parse(ndjson(record(geometry={"points": []})), ND)
    assert report.samples["E_SCHEMA"][0].field == "geometry"


def test_ndjson_duplicate_design_id() -> None:
    _, report = parse(ndjson(record("d1"), record("d1")), ND)
    assert report.errors["E_DUPLICATE_DESIGN"] == 1


def test_ndjson_overlong_line_is_skipped() -> None:
    data = ndjson(record("d1", name="x" * 5000), record("d2"))
    designs, report = parse(data, ND, IngestLimits(max_line_bytes=1024))
    assert [d.external_id for d in designs] == ["d2"]
    assert report.errors["E_LINE_TOO_LONG"] == 1


def test_ndjson_bom_and_bad_utf8_line() -> None:
    data = b"\xef\xbb\xbf" + ndjson(record("d1")).encode() + b'{"design_id": "\xff"}\n'
    designs, report = parse(data, ND)
    assert len(designs) == 1
    assert report.errors["E_ENCODING"] == 1


def test_json_array_streams_elements() -> None:
    designs, report = parse(json.dumps([record("d1"), record("d2", staples=[])]), JS)
    assert [d.external_id for d in designs] == ["d1"]
    assert report.errors["E_NO_STAPLES"] == 1
    assert report.location_kind == "index"
    assert report.samples["E_NO_STAPLES"][0].location == 1


def test_truncated_json_array_aborts() -> None:
    with pytest.raises(IngestAborted) as exc:
        parse(json.dumps([record("d1"), record("d2")])[:-40], JS)
    assert exc.value.issue.code == "E_JSON"


@pytest.mark.parametrize(
    ("prefix", "fmt", "ok"),
    [
        (b"design_id,strand_id,strand_type,sequence\n", DesignFormat.CSV, True),
        (b"\xef\xbb\xbfdesign_id,strand_id", DesignFormat.CSV, True),
        (b"name,sequence\n", DesignFormat.CSV, False),
        (b'  [{"design_id"', DesignFormat.JSON, True),
        (b'{"design_id"', DesignFormat.JSON, False),
        (b'{"design_id"', DesignFormat.NDJSON, True),
        (b"\x89PNG\r\n\x1a\n\x00\x00", DesignFormat.NDJSON, False),
        (b"   ", DesignFormat.CSV, False),
        ("design_id,é".encode()[:-1], DesignFormat.CSV, True),  # split multi-byte char at chunk edge
    ],
)
def test_sniff(prefix: bytes, fmt: DesignFormat, ok: bool) -> None:
    assert (sniff(prefix, fmt) is None) is ok
