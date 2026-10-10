"""Generate SYNTHETIC design datasets for demos and scale tests.

The output is random data in the canonical input formats. Staples are reverse complements of
consecutive scaffold segments so that coordinates are self-consistent; the designs are NOT
real origami designs and carry no measurements.

    python scripts/generate_synthetic.py --designs 3 --format csv --out ../examples/synthetic_designs.csv
"""

import argparse
import json
import random
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any, TextIO

COMPLEMENT = str.maketrans("ACGT", "TGCA")


def revcomp(seq: str) -> str:
    return seq.translate(COMPLEMENT)[::-1]


def designs(
    n: int, scaffold_len: int, staple_len: int, variant_every: int, seed: int
) -> Iterator[dict[str, Any]]:
    rng = random.Random(seed)
    for d in range(n):
        scaffold = "".join(rng.choice("ACGT") for _ in range(scaffold_len))
        staples = []
        for i, start in enumerate(range(0, scaffold_len - staple_len + 1, staple_len)):
            seq = revcomp(scaffold[start : start + staple_len])
            candidates = []
            if variant_every and i % variant_every == 0:
                pos = rng.randrange(staple_len)
                candidates.append(
                    seq[:pos] + rng.choice([b for b in "ACGT" if b != seq[pos]]) + seq[pos + 1 :]
                )
            staples.append(
                {
                    "id": f"s{i:04d}",
                    "sequence": seq,
                    "helix": i % 6,
                    "start": start,
                    "end": start + staple_len - 1,
                    "candidates": candidates,
                }
            )
        yield {
            "design_id": f"synthetic_{d:05d}",
            "name": f"Synthetic design {d}",
            "scaffold": {"id": "scaffold", "sequence": scaffold},
            "staples": staples,
            "metadata": {"source": "synthetic", "generator_seed": seed},
        }


def write_csv(out: TextIO, items: Iterator[dict[str, Any]]) -> None:
    out.write("design_id,design_name,strand_id,strand_type,sequence,helix,start,end,candidate_group,source\n")
    for d in items:
        did, name = d["design_id"], d["name"]
        out.write(f"{did},{name},{d['scaffold']['id']},scaffold,{d['scaffold']['sequence']},,,,,synthetic\n")
        for s in d["staples"]:
            out.write(
                f"{did},{name},{s['id']},staple,{s['sequence']},{s['helix']},{s['start']},{s['end']},,synthetic\n"
            )
            for j, c in enumerate(s["candidates"]):
                out.write(f"{did},{name},{s['id']}_v{j + 1},staple_variant,{c},,,,{s['id']},synthetic\n")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--designs", type=int, default=3)
    p.add_argument("--scaffold-length", type=int, default=256)
    p.add_argument("--staple-length", type=int, default=32)
    p.add_argument(
        "--variant-every", type=int, default=3, help="add one variant to every Nth staple (0 = none)"
    )
    p.add_argument("--format", choices=["csv", "ndjson", "json"], default="csv")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--out", type=Path, help="output file (default: stdout)")
    a = p.parse_args()

    items = designs(a.designs, a.scaffold_length, a.staple_length, a.variant_every, a.seed)
    out = a.out.open("w", encoding="utf-8", newline="") if a.out else sys.stdout
    try:
        if a.format == "csv":
            write_csv(out, items)
        elif a.format == "ndjson":
            for d in items:
                out.write(json.dumps(d, separators=(",", ":")) + "\n")
        else:
            out.write("[\n")
            for i, d in enumerate(items):
                out.write(("," if i else "") + json.dumps(d, separators=(",", ":")) + "\n")
            out.write("]\n")
    finally:
        if a.out:
            out.close()


if __name__ == "__main__":
    main()
