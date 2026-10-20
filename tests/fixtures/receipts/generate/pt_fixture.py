"""Build signed transcript fixtures with paper-trail's own code (contract-v2).

The live transcript.json answers 401 without a platform token, so the fixture is produced by
paper-trail's real render node (rounds_struct + transcript_hash) and its real
GET /debates/{id}/transcript.json route (sign_transcript over canonical_transcript_json), served
through FastAPI's TestClient so the bytes are exactly the HTTP body paper-trail would send. The
signing key is generated here; its public half is served by the real /platform/receipt-public-key.

usage: python -I pt_fixture.py <paper-trail src dir> <out dir>
  where <paper-trail src dir> is `git -C paper-trail-backend archive contract-v2 src | tar -x`
  output, run with paper-trail-backend's own virtualenv. Each run generates a new key.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(src))
out.mkdir(parents=True, exist_ok=True)

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

key = Ed25519PrivateKey.generate()
pem = key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
).decode("ascii")

from paper_trail.core.config import settings  # noqa: E402

settings.transcript_signing_key = pem
settings.langfuse_public_key = ""
settings.langfuse_secret_key = ""

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from paper_trail.agents.nodes.render import render  # noqa: E402
from paper_trail.api.deps import get_service  # noqa: E402
from paper_trail.api.routers.debates import router as debates_router  # noqa: E402
from paper_trail.api.routers.platform import router as platform_router  # noqa: E402
from paper_trail.models.debate import Debate  # noqa: E402

CERT = "2b9f6a1e-4c3d-4e5f-9a7b-8c6d5e4f3a2b"


def state_rounds_a() -> list[dict]:
    return [
        {
            "side": "skeptic",
            "round": 1,
            "argument": 'Small entities pay less: the "basic" fee isn\'t universal.\n\n- tab\there\n- back\\slash',
            "citations": [{"type": "url", "ref": "https://www.uspto.gov/fees", "title": None}],
        },
        {
            "side": "proponent",
            "round": 1,
            "argument": f"The schedule lists $350.00 — the basic filing fee [cert:{CERT}]. Café, 東京.",
            "citations": [
                {"type": "cert", "ref": CERT, "title": "USPTO fee schedule"},
                {"type": "bogus", "ref": "x", "title": "dropped"},
            ],
        },
        {
            "side": "proponent",
            "round": 2,
            "argument": "Round two: the large-entity fee is unchanged.",
            "citations": [],
        },
        {
            "side": "skeptic",
            "round": 2,
            "argument": "Conceded for large entities.",
            "citations": [],
        },
    ]


def state_rounds_b() -> list[dict]:
    return [
        {
            "side": "proponent",
            "round": 1,
            "argument": "Emoji 🚀 and a bell \u0007 and a line separator   and DEL \u007f.",
            "citations": [{"type": "url", "ref": "https://example.org/a?b=1&c=2", "title": "<x>"}],
        },
        {
            "side": "skeptic",
            "round": 1,
            "argument": "",
            "citations": [],
        },
    ]


async def rendered(claim: str, verdict: str, confidence: float, rounds: list[dict]) -> dict:
    return await render(
        {
            "claim": claim,
            "verdict": verdict,
            "confidence": confidence,
            "reasoning": "",
            "rounds": rounds,
        }  # type: ignore[arg-type]
    )


def debate(debate_id: str, claim: str, verdict: str, confidence: float, rounds, r: dict | None) -> Debate:
    d = Debate(
        id=uuid.UUID(debate_id),
        claim=claim,
        max_rounds=3,
        status="done",
        verdict=verdict,
        confidence=confidence,
        rounds=rounds,
    )
    if r is not None:
        d.transcript_md = r["transcript_md"]
        d.rounds_struct = r["rounds_struct"]
        d.transcript_hash = r["transcript_hash"]
    else:  # a debate from before the render node stored a hash: the route computes it
        d.transcript_md = "legacy"
        d.rounds_struct = None
        d.transcript_hash = None
    return d


CASES = {
    "a": ("889d7f2b-33c0-432a-b956-8a360f7b9497", "The USPTO basic filing fee is $350 — “basic” only.", "TRUE", 0.82, state_rounds_a, True),
    "b": ("3f1c9e2a-7b4d-4c8e-9f0a-1b2c3d4e5f60", "Integral confidence 🚀 claim", "FALSE", 1.0, state_rounds_b, True),
    "legacy": ("6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d", "A legacy debate with no stored hash", "INCONCLUSIVE", 5e-05, state_rounds_b, False),
}

store: dict[str, Debate] = {}


class FakeService:
    async def get(self, debate_id):
        return store.get(str(debate_id))


app = FastAPI()
app.include_router(debates_router)
app.include_router(platform_router)
app.dependency_overrides[get_service] = lambda: FakeService()
client = TestClient(app)

for name, (did, claim, verdict, conf, rounds_fn, with_render) in CASES.items():
    rounds = rounds_fn()
    r = asyncio.run(rendered(claim, verdict, conf, rounds)) if with_render else None
    if not with_render:
        # Legacy rows carry raw `rounds` only (no rounds_struct): the route adapts them.
        rounds = [
            {"side": e["side"], "round": e["round"], "argument": e["argument"], "citations": e["citations"]}
            for e in rounds
        ]
    store[did] = debate(did, claim, verdict, conf, rounds, r)
    res = client.get(f"/debates/{did}/transcript.json")
    assert res.status_code == 200, res.text
    (out / f"transcript-{name}.json").write_bytes(res.content)
    print(name, res.content[:120])

res = client.get("/platform/receipt-public-key")
assert res.status_code == 200, res.text
(out / "receipt-key.json").write_bytes(res.content)
print("key", res.content)
