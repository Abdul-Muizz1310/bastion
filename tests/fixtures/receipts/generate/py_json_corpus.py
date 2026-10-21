"""A corpus of CPython's own json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)
output, so bastion's mirror of it is tested against the real thing.

Encoding (so a JSON file can carry Python's int/float distinction and any dict key):
  float -> {"$f": "<16 hex digits of the IEEE-754 bits>"}; dict -> {"$d": [[key, value], ...]};
  int, str, bool, None and list as themselves.

usage: python -I py_json_corpus.py <out file>
"""

from __future__ import annotations

import json
import random
import struct
import sys

rng = random.Random(20261020)


def bits(x: float) -> str:
    return struct.pack(">d", x).hex()


def enc(v):
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return {"$f": bits(v)}
    if isinstance(v, list):
        return [enc(x) for x in v]
    if isinstance(v, dict):
        return {"$d": [[k, enc(x)] for k, x in v.items()]}
    raise TypeError(type(v))


def dumps(v) -> str:
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


floats: list[float] = [
    0.0, -0.0, 1.0, -1.0, 0.5, 0.1, 0.2, 0.1 + 0.2, 0.82, 0.85, 1 / 3, 2 / 3, 100.0, 1e15, 1e16, 1e17,
    9999999999999998.0, 1.5e16, 123456789012345680.0, 1e21, 1e22, 1e100, 1e308, 1.7976931348623157e308,
    5e-324, 2.2250738585072014e-308, 1e-4, 1e-5, 0.0001, 0.00012, 0.00001, 5e-05, 1.5e-05, 0.001,
    2.0**53, 2.0**53 + 2, 2.0**63, 0.30000000000000004, 1e-7, 1.234e-10, 12345.678, 4.35, 0.07,
]
for _ in range(800):  # arbitrary finite doubles across the whole exponent range
    while True:
        x = struct.unpack(">d", rng.getrandbits(64).to_bytes(8, "big"))[0]
        if x == x and x not in (float("inf"), float("-inf")):
            break
    floats.append(x)
for _ in range(500):  # the confidence-like values a debate produces
    floats.append(round(rng.random(), rng.randint(1, 6)))
    floats.append(rng.random() * 10 ** rng.randint(-8, 20))

strings = [
    "", "plain", 'quote " and backslash \\', "\b\f\n\r\t", "".join(chr(c) for c in range(0x20)),
    "\x7f DEL", "  ", "Café — 東京", "emoji 🚀 😀", " private", "/slash/", "<html>&",
]

values = []
for f in floats[:60]:
    values.append(f)
for s in strings:
    values.append(s)
values += [
    {"b": 1, "a": 2.0, "c": [1, 2.5, None, True, False]},
    {"": 1, "😀": 2, "z": 3, "Z": 4, "é": 5, "": 6},  # code-point order, not UTF-16 order
    {"nested": {"y": [{"k": "v", "a": -0.0}], "x": 0}},
    [[], {}, [{}], -12345678901234, 0, -1],
    {"claim": "c", "verdict": "TRUE", "confidence": 1.0, "rounds": [{"round": 1, "confidence": None}]},
]

corpus = [{"value": enc(v), "dumps": dumps(v)} for v in values]
reprs = [[bits(f), repr(f)] for f in floats]
with open(sys.argv[1], "w", encoding="utf-8") as fh:
    json.dump({"python": sys.version.split()[0], "floats": reprs, "values": corpus}, fh, ensure_ascii=False)
print(len(reprs), len(corpus))
