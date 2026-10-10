"""Builders for tiny SYNTHETIC oxDNA / caDNAno test inputs (test data only, not real structures).

Coordinates are placed on a straight line with unit orientation vectors simply so the files are
syntactically and topologically valid; they are not a physical model of anything.
"""

import json


def oxdna_classic(sequences: list[str], spacing: float = 0.7) -> tuple[str, str]:
    """Classic topology lists each strand 3'->5' (as oxDNA tools write it); configuration in that order."""
    n = sum(map(len, sequences))
    top = [f"{n} {len(sequences)}"]
    conf = ["t = 0", "b = 100 100 100", "E = 0 0 0"]
    idx = 0
    for si, seq in enumerate(sequences):
        rev = seq[::-1]  # 3' -> 5'
        for k, base in enumerate(rev):
            i = idx + k
            n3 = i - 1 if k > 0 else -1
            n5 = i + 1 if k < len(rev) - 1 else -1
            top.append(f"{si + 1} {base} {n3} {n5}")
            x = (len(rev) - 1 - k) * spacing  # 5' end at x = 0
            conf.append(f"{x} {si * 2.0} 0 1 0 0 0 0 1 0 0 0 0 0 0")
        idx += len(seq)
    return "\n".join(top) + "\n", "\n".join(conf) + "\n"


def oxdna_new(sequences: list[str], spacing: float = 0.7) -> tuple[str, str]:
    n = sum(map(len, sequences))
    top = [f"{n} {len(sequences)} 5->3", *sequences]
    conf = ["t = 0", "b = 100 100 100", "E = 0 0 0"]
    for si, seq in enumerate(sequences):
        conf += [f"{k * spacing} {si * 2.0} 0 1 0 0 0 0 1 0 0 0 0 0 0" for k in range(len(seq))]
    return "\n".join(top) + "\n", "\n".join(conf) + "\n"


def cadnano_two_helices(length: int = 32) -> str:
    """Scaffold runs 5'->3' along helix 0, crosses at the end, returns on helix 1; one staple crosses too."""
    empty = [-1, -1, -1, -1]
    scaf0 = [list(empty) for _ in range(length)]
    scaf1 = [list(empty) for _ in range(length)]
    stap0 = [list(empty) for _ in range(length)]
    stap1 = [list(empty) for _ in range(length)]
    for i in range(length):  # helix 0: 5' at 0 ... 3' at length-1 -> crossover to helix 1 at length-1
        scaf0[i] = [0 if i else -1, i - 1 if i else -1, 0, i + 1] if i < length - 1 else [0, i - 1, 1, i]
    for i in range(length):  # helix 1 runs backwards: from length-1 down to 0 (3' end)
        prev = [0, i] if i == length - 1 else [1, i + 1]
        nxt = [1, i - 1] if i > 0 else [-1, -1]
        scaf1[i] = prev + nxt
    # staple: helix 1 positions 8..15 (5'->3' increasing), crossover to helix 0 positions 15..8 (decreasing)
    for i in range(8, 16):
        prev = [1, i - 1] if i > 8 else [-1, -1]
        nxt = [1, i + 1] if i < 15 else [0, 15]
        stap1[i] = prev + nxt
    for i in range(15, 7, -1):
        prev = [1, 15] if i == 15 else [0, i + 1]
        nxt = [0, i - 1] if i > 8 else [-1, -1]
        stap0[i] = prev + nxt
    vstrands = [
        {
            "num": 0,
            "row": 0,
            "col": 0,
            "scaf": scaf0,
            "stap": stap0,
            "loop": [0] * length,
            "skip": [0] * length,
        },
        {
            "num": 1,
            "row": 0,
            "col": 1,
            "scaf": scaf1,
            "stap": stap1,
            "loop": [0] * length,
            "skip": [0] * length,
        },
    ]
    return json.dumps({"name": "synthetic two-helix test", "vstrands": vstrands})
