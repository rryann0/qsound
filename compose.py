#!/usr/bin/env python3
"""Compose from the command line and save everything needed to prove how a piece was made.

    python compose.py --style hyperpop --key A --seed 1197 --out pieces/first

Writes first.json (the whole piece and its provenance) and first.qasm (every circuit).
"""

import argparse
import json
from pathlib import Path

from qsound import compose
from qsound.styles import DEFAULT_STYLE, STYLES
from qsound.theory import KEYS, MODES

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--style", choices=STYLES, default=DEFAULT_STYLE)
parser.add_argument("--key", choices=KEYS, default="A")
parser.add_argument("--mode", choices=MODES)
parser.add_argument("--bpm", type=int)
parser.add_argument("--bars", type=int, default=16, choices=(8, 16, 32))
parser.add_argument("--entanglement", type=float, default=0.8)
parser.add_argument("--interference", type=float, default=0.5)
parser.add_argument("--noise", type=float, default=0.0)
parser.add_argument("--seed", type=int, default=1197)
parser.add_argument("--out", default="piece")
args = parser.parse_args()

piece = compose(style=args.style, key=args.key, mode=args.mode, bpm=args.bpm, bars=args.bars,
                entanglement=args.entanglement, interference=args.interference, noise=args.noise, seed=args.seed)
out = Path(args.out)
out.parent.mkdir(parents=True, exist_ok=True)
out.with_suffix(".json").write_text(json.dumps(piece))
out.with_suffix(".qasm").write_text("\n".join(f"// {c['name']}\n{c['qasm']}" for c in piece["circuits"]))
print(f"{out}.json and {out}.qasm: {piece['styleName']}, {piece['bars']} bars, {piece['provenance']['totalQubits']} qubits")
