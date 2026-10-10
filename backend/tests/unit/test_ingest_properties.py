"""Property tests: the three formats describe the same canonical model."""

import json

from hypothesis import given, settings
from hypothesis import strategies as st

from origami_core.models import Design, DesignFormat

from .ingest_helpers import parse

seqs = st.text(alphabet="ACGT", min_size=1, max_size=40)
ids = st.from_regex(r"[a-z][a-z0-9_]{0,10}", fullmatch=True)


@st.composite
def design_records(draw: st.DrawFn) -> dict[str, object]:
    scaffold = draw(st.text(alphabet="ACGT", min_size=40, max_size=200))
    staple_ids = draw(st.lists(ids, min_size=1, max_size=6, unique=True).filter(lambda xs: "scaf" not in xs))
    staples = []
    for sid in staple_ids:
        start = draw(st.integers(0, len(scaffold) - 1))
        end = draw(st.integers(start, len(scaffold) - 1))
        staples.append(
            {
                "id": sid,
                "sequence": draw(seqs),
                "helix": draw(st.integers(0, 20)),
                "start": start,
                "end": end,
                "candidates": draw(st.lists(seqs, max_size=3)),
            }
        )
    return {"design_id": draw(ids), "scaffold": {"id": "scaf", "sequence": scaffold}, "staples": staples}


def to_csv(recs: list[dict[str, object]]) -> str:
    lines = ["design_id,strand_id,strand_type,sequence,helix,start,end,candidate_group"]
    for r in recs:
        did, scaf = r["design_id"], r["scaffold"]
        lines.append(f"{did},scaf,scaffold,{scaf['sequence']},,,,")  # type: ignore[index]
        for s in r["staples"]:  # type: ignore[attr-defined]
            lines.append(f"{did},{s['id']},staple,{s['sequence']},{s['helix']},{s['start']},{s['end']},")
            lines.extend(
                f"{did},{s['id']}__v{j},staple_variant,{c},,,,{s['id']}"
                for j, c in enumerate(s["candidates"])
            )
    return "\n".join(lines) + "\n"


def canonical(designs: list[Design]) -> list[dict[str, object]]:
    return [d.model_dump(exclude={"name", "metadata", "measurements"}) for d in designs]


@settings(max_examples=60, deadline=None)
@given(st.lists(design_records(), min_size=1, max_size=4, unique_by=lambda r: r["design_id"]))
def test_csv_ndjson_and_json_agree(recs: list[dict[str, object]]) -> None:
    from_csv, r1 = parse(to_csv(recs), DesignFormat.CSV)
    from_nd, r2 = parse("".join(json.dumps(r) + "\n" for r in recs), DesignFormat.NDJSON)
    from_js, r3 = parse(json.dumps(recs), DesignFormat.JSON)
    assert r1.error_count == r2.error_count == r3.error_count == 0
    assert canonical(from_csv) == canonical(from_nd) == canonical(from_js)
    assert len(from_csv) == len(recs)
