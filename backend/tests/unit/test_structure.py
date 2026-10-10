import json
import math

import pytest

from origami_core.models import Design, Strand
from origami_core.structure import StructureError, map_design, parse_cadnano, parse_oxdna, viewer_geometry

from ..structure_fixtures import cadnano_two_helices, oxdna_classic, oxdna_new

SCAF, S1, S2 = "ACGTTGCAACGTTGCA", "TGCAACGT", "GGCCAATT"


def test_oxdna_classic_and_new_topologies_parse_to_the_same_strands() -> None:
    a = parse_oxdna(*oxdna_classic([SCAF, S1, S2]))
    b = parse_oxdna(*oxdna_new([SCAF, S1, S2]))
    assert [s.sequence for s in a.strands] == [s.sequence for s in b.strands] == [SCAF, S1, S2]  # 5'->3'
    assert (a.topology_format, b.topology_format) == ("classic", "new")
    assert a.summary()["nucleotides"] == 32 and a.summary()["has_coordinates"] is True
    # Coordinates are kept exactly as stored; the viewer copy is only translated to its centroid.
    first = a.strands[0].nucleotides[0]
    assert a.positions[first] == (0.0, 0.0, 0.0)
    g = viewer_geometry(a)
    assert g["kind"] == "molecular" and g["nucleotides"] == 32 and len(g["positions"]) == 96
    assert abs(sum(g["positions"][0::3])) < 1e-6  # centred
    assert [s["length"] for s in g["strands"]] == [16, 8, 8] and g["strands"][1]["offset"] == 16


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda t, c: ("", c), "E_TOP_EMPTY"),
        (lambda t, c: ("x y\n" + t.split("\n", 1)[1], c), "E_TOP_HEADER"),
        (lambda t, c: (t.replace("1 A", "1 X", 1), c), "E_TOP_BASE"),
        (lambda t, c: (t.rsplit("\n", 2)[0] + "\n", c), "E_TOP_COUNT"),
        (lambda t, c: (t.replace("1 T 1 3", "1 T 1 7", 1), c), "E_TOP_LINKAGE"),
        (lambda t, c: (t, c.rsplit("\n", 2)[0] + "\n"), "E_CONF_COUNT"),
        (lambda t, c: (t, c.replace("1 0 0 0 0 1", "2 0 0 0 0 1", 1)), "E_CONF_ORIENTATION"),
        (lambda t, c: (t, c.replace("0 1 0 0", "nan 1 0 0", 1)), "E_CONF_NUMBER"),
        (lambda t, c: (t, "b = 1 1 1\n" + c), "E_CONF_HEADER"),
    ],
)
def test_oxdna_invalid_inputs_are_rejected_with_codes(mutate, code) -> None:  # type: ignore[no-untyped-def]
    top, conf = oxdna_classic(["ACGTAC", "GGTT"])
    top, conf = mutate(top, conf)
    with pytest.raises(StructureError) as exc:
        parse_oxdna(top, conf)
    assert code in {i.code for i in exc.value.issues}, [i.code for i in exc.value.issues]


def test_cadnano_topology_is_validated_and_summarised_without_coordinates() -> None:
    s = parse_cadnano(cadnano_two_helices(32)).summary()
    assert s["has_coordinates"] is False and s["format"] == "cadnano"
    assert (s["helices"], s["array_length"], s["scaffold_strands"], s["staple_strands"]) == (2, 32, 1, 1)
    assert (s["scaffold_crossovers"], s["staple_crossovers"], s["scaffold_bases"], s["staple_bases"]) == (
        1,
        1,
        64,
        16,
    )
    assert s["lattice_hint"] == "multiple of 32 (consistent with square)"

    doc = json.loads(cadnano_two_helices(32))
    doc["vstrands"][0]["scaf"][5][3] = 9  # 'next' no longer reciprocated
    with pytest.raises(StructureError) as exc:
        parse_cadnano(json.dumps(doc))
    assert {i.code for i in exc.value.issues} == {"E_CADNANO_LINK"}
    for bad, code in (("{nope", "E_CADNANO_JSON"), ('{"name": "x"}', "E_CADNANO_SCHEMA")):
        with pytest.raises(StructureError) as exc:
            parse_cadnano(bad)
        assert exc.value.issues[0].code == code


def test_design_strands_map_only_by_unique_exact_sequence() -> None:
    structure = parse_oxdna(*oxdna_classic([SCAF, S1, S2]))
    design = Design(
        external_id="d1",
        scaffold=Strand(id="scaf", sequence=SCAF),
        staples=(Strand(id="s1", sequence=S1), Strand(id="s2", sequence=S2)),
    )
    m = map_design(design, structure)
    assert m.status == "verified" and m.scaffold_strand == 0 and m.staples == {"s1": 1, "s2": 2}
    assert m.roles()[0]["role"] == "scaffold" and m.roles()[2] == {"role": "staple", "design_strand_id": "s2"}

    other = Design(
        external_id="d2",
        scaffold=Strand(id="scaf", sequence=SCAF),
        staples=(Strand(id="s1", sequence=S1), Strand(id="sX", sequence="AAAACCCC")),
    )
    m2 = map_design(other, structure)
    assert m2.status == "partial" and m2.unmatched == ["sX"] and "sX" not in m2.staples

    dup = parse_oxdna(*oxdna_classic([SCAF, S1, S1]))
    m3 = map_design(design, dup)
    assert "s1" in m3.ambiguous and "s1" not in m3.staples  # never guess between identical strands


def test_straight_placeholder_strands_are_flagged_and_helical_ones_are_not() -> None:
    straight = parse_oxdna(*oxdna_classic([SCAF, S1, S2]))
    assert "W_NONHELICAL_GEOMETRY" in {w.code for w in straight.warnings}

    # Test geometry only: points on a helix (radius 0.6, rise 0.39, 34.3 deg/nt), not a physical model.
    top, _ = oxdna_classic([SCAF])
    conf = ["t = 0", "b = 100 100 100", "E = 0 0 0"]
    for k in range(len(SCAF)):  # classic topology lists 3'->5', so walk backwards along the helix
        j = len(SCAF) - 1 - k
        a = math.radians(34.3) * j
        conf.append(f"{0.6 * math.cos(a)} {0.6 * math.sin(a)} {0.39 * j} 1 0 0 0 0 1 0 0 0 0 0 0")
    helical = parse_oxdna(top, "\n".join(conf) + "\n")
    assert "W_NONHELICAL_GEOMETRY" not in {w.code for w in helical.warnings}
