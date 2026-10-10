import pytest

from origami_core.ingest import IngestAborted, IngestLimits

from .ingest_helpers import SCAFFOLD, csv_of, parse

GOOD = (
    f"d1,scaf,scaffold,{SCAFFOLD},,,,",
    "d1,s1,staple,acgtacgt,0,0,7,",
    "d1,s1_v,staple_variant,ACGTACGA,,,,s1",
    "d1,s2,staple,TTTTGGGG,1,8,15,",
)


def test_parses_valid_design_with_variants_and_normalizes_case() -> None:
    designs, report = parse(csv_of(*GOOD))
    assert report.error_count == 0
    (d,) = designs
    assert d.external_id == "d1"
    assert d.scaffold is not None and len(d.scaffold.sequence) == 64
    assert [s.id for s in d.staples] == ["s1", "s2"]
    assert d.staples[0].sequence == "ACGTACGT"
    assert d.staples[0].candidates == ("ACGTACGA",)
    assert (d.staples[1].helix, d.staples[1].start, d.staples[1].end) == (1, 8, 15)
    assert report.designs_valid == 1 and report.records_read == 4


def test_handles_bom_crlf_quoted_fields_and_blank_lines() -> None:
    header = "design_id,strand_id,strand_type,sequence,helix,start,end,candidate_group,note"
    rows = [row + "," for row in GOOD[:-1]] + ["", 'd1,s2,staple,TTTTGGGG,1,8,15,,"a, quoted note"']
    data = "﻿" + csv_of(*rows, header=header).replace("\n", "\r\n")
    designs, report = parse(data)
    assert report.error_count == 0, report.summary()
    assert designs[0].metadata == {"note": "a, quoted note"}


def test_measurement_columns_are_numeric_and_kept_separate_from_metadata() -> None:
    header = "design_id,strand_id,strand_type,sequence,meas_gel_yield,batch"
    designs, report = parse(csv_of("d1,s1,staple,ACGT,0.42,B7", "d1,s2,staple,TTTT,,B7", header=header))
    assert report.error_count == 0
    (d,) = designs
    assert d.metadata == {"batch": "B7"}
    assert [(m.name, m.value, m.source) for m in d.measurements] == [("gel_yield", 0.42, "user_import")]


def test_missing_required_column_aborts() -> None:
    with pytest.raises(IngestAborted) as exc:
        parse("design_id,strand_id,sequence\nd1,s1,ACGT\n")
    assert exc.value.issue.code == "E_MISSING_COLUMN"


def test_empty_file_aborts() -> None:
    with pytest.raises(IngestAborted) as exc:
        parse("")
    assert exc.value.issue.code == "E_EMPTY"


def test_invalid_utf8_aborts_with_encoding_error() -> None:
    with pytest.raises(IngestAborted) as exc:
        parse(csv_of("d1,s1,staple,ACGT,,,,").encode() + b"d2,s1,staple,\xff\xfe,,,,\n")
    assert exc.value.issue.code == "E_ENCODING"


@pytest.mark.parametrize(
    ("row", "code"),
    [
        ("d2,s1,staple,ACGU,,,,", "E_ALPHABET"),
        ("d2,s1,staple,,,,,", "E_REQUIRED"),
        ("d2,s1,staple,ACGT,x,,,", "E_INTEGER"),
        ("d2,s1,staple,ACGT,,9,3,", "E_RANGE"),
        ("d2,s1,linker,ACGT,,,,", "E_STRAND_TYPE"),
        ("d2,s1,staple,ACGT,,,", "E_COLUMN_COUNT"),
        ("d2,v1,staple_variant,ACGT,,,,missing", "E_UNKNOWN_CANDIDATE_GROUP"),
    ],
)
def test_row_errors_reject_only_the_affected_design(row: str, code: str) -> None:
    designs, report = parse(csv_of(*GOOD, "d2,s0,staple,ACGT,,,,", row))
    assert [d.external_id for d in designs] == ["d1"]
    assert report.errors[code] >= 1
    assert report.designs_invalid == 1
    sample = report.samples[code][0]
    assert sample.design_id == "d2" and sample.location is not None


def test_strand_level_issues_point_at_the_offending_row() -> None:
    _, report = parse(
        csv_of(
            f"d1,scaf,scaffold,{SCAFFOLD},,,,",  # line 2
            "d1,s1,staple,ACGT,0,0,3,",  # line 3
            "d1,s2,staple,ACGU,0,4,7,",  # line 4
            "d1,s1v,staple_variant,ACXT,,,,s1",  # line 5
            "d1,bad,staple_variant,ACGT,,,,nope",  # line 6
        )
    )
    by_field = {i.field: i.location for i in report.samples["E_ALPHABET"]}
    assert by_field == {"strand[s2].sequence": 4, "strand[s1].candidates[0]": 5}
    assert report.samples["E_UNKNOWN_CANDIDATE_GROUP"][0].location == 6


def test_coordinates_beyond_scaffold_are_rejected() -> None:
    _, report = parse(csv_of(f"d1,scaf,scaffold,{SCAFFOLD},,,,", "d1,s1,staple,ACGT,0,60,64,"))
    assert report.errors["E_COORD_OUT_OF_RANGE"] == 1


def test_duplicate_strands_and_scaffolds_are_reported() -> None:
    _, report = parse(
        csv_of(
            f"d1,scaf,scaffold,{SCAFFOLD},,,,",
            f"d1,scaf2,scaffold,{SCAFFOLD},,,,",
            "d1,s1,staple,ACGT,,,,",
            "d1,s1,staple,ACGT,,,,",
        )
    )
    assert report.errors["E_MULTIPLE_SCAFFOLDS"] == 1
    assert report.errors["E_DUPLICATE_STRAND"] == 1


def test_non_contiguous_design_rows_are_reported() -> None:
    designs, report = parse(csv_of("d1,s1,staple,ACGT,,,,", "d2,s1,staple,ACGT,,,,", "d1,s2,staple,ACGT,,,,"))
    assert [d.external_id for d in designs] == ["d1", "d2"]
    assert report.errors["E_DUPLICATE_DESIGN"] == 1


def test_design_without_scaffold_is_accepted_with_warning() -> None:
    designs, report = parse(csv_of("d1,s1,staple,ACGT,,,,"))
    assert len(designs) == 1
    assert report.warnings["W_NO_SCAFFOLD"] == 1


def test_conflicting_design_level_values_are_errors() -> None:
    header = "design_id,strand_id,strand_type,sequence,batch"
    _, report = parse(csv_of("d1,s1,staple,ACGT,A", "d1,s2,staple,ACGT,B", header=header))
    assert report.errors["E_CONFLICTING_VALUE"] == 1


def test_n_is_rejected_unless_allowed() -> None:
    rows = csv_of("d1,s1,staple,ACGN,,,,")
    assert parse(rows)[1].errors["E_ALPHABET"] == 1
    assert parse(rows, limits=IngestLimits(allow_n=True))[1].error_count == 0


def test_limits_abort_parsing() -> None:
    rows = csv_of(*(f"d{i},s1,staple,ACGU,,,," for i in range(5)))
    with pytest.raises(IngestAborted) as exc:
        parse(rows, limits=IngestLimits(max_errors=2))
    assert exc.value.issue.code == "E_TOO_MANY_ERRORS"
    with pytest.raises(IngestAborted) as exc:
        parse(csv_of(*GOOD), limits=IngestLimits(max_rows=2))
    assert exc.value.issue.code == "E_ROW_LIMIT"


def test_length_limits_apply_per_strand_kind() -> None:
    _, report = parse(csv_of("d1,s1,staple,ACGTACGTAC,,,,"), limits=IngestLimits(max_staple_length=8))
    assert report.errors["E_LENGTH"] == 1
