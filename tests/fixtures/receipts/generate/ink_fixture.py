"""Build signed dossier-envelope fixtures with inkprint's own code (contract-v2).

The real POST /dossiers/envelope route and the real `create_envelope` service run through FastAPI's
TestClient; only their storage is stubbed (no certificate store, no envelope table), and the clock
is pinned for one case so `issued_at.isoformat()` drops its microseconds. The real
GET /public-key.pem serves the generated key.

A third case, `golden`, signs the request golden_request.mjs derives from golden-dossier.json.

usage: python -I ink_fixture.py <inkprint src dir> <out dir> <golden request json>
  where <inkprint src dir> is `git -C inkprint-backend archive contract-v2 src | tar -x` output,
  run with inkprint-backend's own virtualenv.
"""

from __future__ import annotations

import json
import sys
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(src))
out.mkdir(parents=True, exist_ok=True)

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from inkprint.api.routers.dossiers import router as dossiers_router  # noqa: E402
from inkprint.platform.health import router as health_router  # noqa: E402
from inkprint.services import envelope_service  # noqa: E402


async def known_certificate(_cid: str):
    return {"id": _cid}


async def no_envelope(_dossier_id: str):
    return None


@asynccontextmanager
async def no_session():
    yield None


async def no_add(_session, _record):
    return None


envelope_service.certificate_service.get_certificate = known_certificate  # type: ignore[assignment]
envelope_service.get_envelope = no_envelope  # type: ignore[assignment]
envelope_service.session_scope = no_session  # type: ignore[assignment]
envelope_service.envelope_repo.add = no_add  # type: ignore[assignment]

key = Ed25519PrivateKey.generate()
app = FastAPI()
app.state.private_key = key
app.state.public_key = key.public_key()
app.state.key_id = "inkprint-ed25519-fixture"
app.include_router(dossiers_router)
app.include_router(health_router)
client = TestClient(app)

REAL_DATETIME = envelope_service.datetime


class PinnedClock(datetime):
    @classmethod
    def now(cls, tz=None):  # noqa: ANN001
        return REAL_DATETIME(2026, 10, 20, 9, 30, 11, 0, tzinfo=UTC)


BODY = {
    "dossier_id": "550e8400-e29b-41d4-a716-446655440000",
    "evidence_cert_ids": [
        "2b9f6a1e-4c3d-4e5f-9a7b-8c6d5e4f3a2b",
        "3c0a7b2f-5d4e-4f60-8b8c-9d7e6f5a4b3c",
    ],
    "debate_transcript_hash": "5cf763b7b6ffad58ace87598b704dc435b07261ff7d7f606a87060699ffe2340",
    "perf_receipt_hash": "7" * 64,
    "metadata": {
        "request_id": "req-dossier-1",
        "audit_digest_at_envelope": "a" * 64,
        "audit_up_to": "8",
        "graph_hashes": "",
        "transcript_signature": "sig/with+chars==",
        "debate_id": "889d7f2b-33c0-432a-b956-8a360f7b9497",
        "zz_unicode": "Café — 東京 🚀",
    },
}

GOLDEN = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))

for name, pinned, body in (("now", False, BODY), ("whole-second", True, BODY), ("golden", False, GOLDEN)):
    envelope_service.datetime = PinnedClock if pinned else REAL_DATETIME  # type: ignore[assignment]
    res = client.post("/dossiers/envelope", json=body)
    assert res.status_code == 200, res.text
    (out / f"envelope-{name}.json").write_bytes(
        json.dumps({"request": body, "response": json.loads(res.content)}, ensure_ascii=False, indent=2).encode("utf-8")
    )
    print(name, json.loads(res.content)["envelope_manifest"]["issued_at"], json.loads(res.content)["created_at"])

res = client.get("/public-key.pem")
assert res.status_code == 200, res.text
(out / "public-key.pem").write_bytes(res.content)
print(res.headers["content-type"], res.content)
