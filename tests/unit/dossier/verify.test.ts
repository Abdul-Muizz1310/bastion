import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Graph } from "@/capabilities/inkthread";
import { storedExcerptOf } from "@/dossier/excerpt";
import { inkprintCanonicalText } from "@/dossier/issuer-forms";
import { auditDigest } from "@/dossier/receipt-math";
import type { StoredReceipt } from "@/dossier/receipts";
import {
  auditBound,
  auditCheck,
  type Check,
  certificatesCheck,
  documentsCheck,
  envelopeAuditBound,
  envelopeCheck,
  certificateIds,
  perfCheck,
  transcriptCheck,
} from "@/dossier/verify";
import { canonicalJson, type Json } from "@/platform/canonical-json";
import type { GatewayResult } from "@/platform/gateway/result";
import { sha256Hex } from "@/platform/sha256";
import {
  auditReceipt,
  certificateReceipts,
  DOSSIER,
  documents,
  EVENTS,
  edit,
  envelopeReceipt,
  evidenceRows,
  eventsUpTo,
  failed,
  GOLDEN,
  GRAPH,
  OUTAGES,
  ok,
  perfReceipt,
  publicKeyBody,
  RECEIPT_KEY,
  TRANSCRIPT,
  transcriptReceipt,
  verifyAllValid,
} from "./verify-golden";

/**
 * "Verify everything" (spec 21 §6.5), the pure checks: each takes what bastion stored and what the
 * issuers answer now, and says pass, fail, unavailable or expired with a reason. A downstream
 * outage is `unavailable`, never a pass; a proven mismatch is a `fail` even while something else is
 * out; an upload inkthread no longer keeps is `expired` (Review focus #5). Signatures are checked
 * against the issuers' live keys, never a key the dossier carries.
 */

const otherKeyPem = () =>
  generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();

const expectState = (check: Check | null, state: Check["state"]) => {
  expect(check?.state, check?.detail).toBe(state);
};

describe("certificates", () => {
  const inputs = (over: Partial<Parameters<typeof certificatesCheck>[0]> = {}) => ({
    evidence: evidenceRows(),
    receipts: certificateReceipts(),
    answer: ok(verifyAllValid()),
    key: ok(publicKeyBody()),
    ...over,
  });
  const check = (over: Partial<Parameters<typeof certificatesCheck>[0]> = {}) =>
    certificatesCheck(inputs(over));
  const withText = (i: number, text: string) =>
    edit(certificateReceipts(), [i, "payload", "text"], text);

  it("asks inkprint by certificate id only — no text, so nothing is re-embedded", () => {
    expect(certificateIds(evidenceRows(), certificateReceipts())).toEqual(
      GOLDEN.certificates.map((c) => c.id),
    );
  });

  it("passes inkprint's real signatures over the canonical stored texts", () => {
    const c = check();
    expect(c).toMatchObject({ name: "certificates", state: "pass" });
    expect(c?.detail).toContain("2 of 2");
    expect(c?.items?.map((i) => [i.ref, i.state])).toEqual(
      GOLDEN.certificates.map((x) => [x.id, "pass"]),
    );
  });

  it.each([
    ['inserting "not"', (t: string) => t.replace("pay 40", "do not pay 40")],
    ["one word changed", (t: string) => t.replace("large", "small")],
    ["a number changed", (t: string) => t.replace("40", "14")],
  ])(
    "fails a certified text with %s, even when inkprint answers valid:true (fuzzy match)",
    (_what, change) => {
      const original = GOLDEN.certificates[0]?.text ?? "";
      const text = change(original);
      // The tamperer rewrites the excerpt too, so only the hash and the signature can catch it.
      const evidence = edit(evidenceRows(), [0, "excerpt"], storedExcerptOf(text));
      const c = check({ receipts: withText(0, text), evidence });
      expectState(c, "fail");
      expect(c?.items?.[0]?.detail).toContain("does not hash");
      expect(c?.items?.[1]?.state).toBe("pass");
    },
  );

  it("passes a text that differs only in what inkprint's canonicalisation removes", () => {
    const original = GOLDEN.certificates[1]?.text ?? "";
    const text = `\u00a0${original.replace(" ", "\u2003\n")}  `;
    const evidence = edit(evidenceRows(), [1, "excerpt"], storedExcerptOf(text));
    expectState(check({ receipts: withText(1, text), evidence }), "pass");
  });

  it("fails a stored hash rewritten to match a tampered text: the signature does not verify", () => {
    const text = (GOLDEN.certificates[0]?.text ?? "").replace("40", "14");
    const receipts = edit(withText(0, text), [0, "hash"], sha256Hex(inkprintCanonicalText(text)));
    const c = check({
      receipts,
      evidence: edit(evidenceRows(), [0, "excerpt"], storedExcerptOf(text)),
    });
    expectState(c, "fail");
    expect(c?.items?.[0]?.detail).toContain("signature");
  });

  it("fails against any key but inkprint's", () => {
    const key = ok(publicKeyBody(new TextEncoder().encode(otherKeyPem())));
    expectState(check({ key }), "fail");
  });

  it("fails an unsigned certificate receipt", () => {
    expectState(check({ receipts: edit(certificateReceipts(), [0, "signature"], null) }), "fail");
  });

  it("fails an excerpt the page shows that is not the certified text", () => {
    const evidence = edit(evidenceRows(), [1, "excerpt"], "The basic filing fee is $35.");
    const c = check({ evidence });
    expectState(c, "fail");
    expect(c?.items?.[1]?.detail).toContain("excerpt");
  });

  it("fails an evidence row whose certificate has no stored receipt", () => {
    const c = check({ receipts: certificateReceipts().slice(1) });
    expectState(c, "fail");
    expect(c?.items?.[0]?.detail).toContain("no certificate receipt");
  });

  it("fails a certificate receipt no evidence row shows", () => {
    expectState(check({ evidence: evidenceRows().slice(1) }), "fail");
  });

  it("fails a receipt with no stored text", () => {
    expectState(
      check({ receipts: edit(certificateReceipts(), [0, "payload"], { key: "w" }) }),
      "fail",
    );
  });

  it("fails a text with no form inkprint could have certified (never throws)", () => {
    const receipts = withText(0, `a${String.fromCharCode(0xd800)}`);
    expect(() => check({ receipts })).not.toThrow();
    expectState(check({ receipts }), "fail");
  });

  it("fails a certificate inkprint no longer holds intact", () => {
    const answer = ok(
      edit(verifyAllValid(), ["results", 1], {
        certificate_id: GOLDEN.certificates[1]?.id,
        valid: false,
        checks: { signature: true, hash: false },
        reason: null,
      }),
    );
    const c = check({ answer });
    expectState(c, "fail");
    expect(c?.items?.[1]?.detail).toContain("hash");
  });

  it("fails a certificate inkprint does not know, or returns no result for", () => {
    const unknown = ok(
      edit(verifyAllValid(), ["results", 0], {
        certificate_id: GOLDEN.certificates[0]?.id,
        valid: false,
        checks: {},
        reason: "unknown_certificate",
      }),
    );
    expect(check({ answer: unknown })?.items?.[0]?.detail).toContain("unknown_certificate");
    expectState(check({ answer: ok({ results: verifyAllValid().results.slice(1) }) }), "fail");
    // valid:true with no checks at all proves nothing.
    const empty = ok(edit(verifyAllValid(), ["results", 0, "checks"], {}));
    expectState(check({ answer: empty }), "fail");
  });

  it.each(OUTAGES)("is unavailable, never a pass, when inkprint is out: %s", (_why, outage) => {
    expectState(check({ answer: outage }), "unavailable");
    expectState(check({ key: outage }), "unavailable");
  });

  it("says when to retry after the gateway's rate limit", () => {
    expect(check({ answer: failed("rate_limited", 429, { retryAfterS: 12 }) })?.detail).toContain(
      "12 s",
    );
  });

  it("is unavailable when inkprint or its key was not asked", () => {
    expectState(check({ answer: null }), "unavailable");
    expectState(check({ key: null }), "unavailable");
  });

  it("fails when inkprint publishes no key (404), or the ids cannot be sent", () => {
    expectState(check({ key: failed("downstream_error", 404) }), "fail");
    expectState(check({ answer: failed("invalid_input", 422, { detail: "items.0" }) }), "fail");
  });

  it("a tampered text fails even while inkprint is out (a proven fail beats unavailable)", () => {
    const receipts = withText(0, "tampered");
    const c = check({ receipts, answer: failed("asleep", 504), key: failed("asleep", 504) });
    expectState(c, "fail");
  });

  describe("the excerpt the page shows must be exactly what seal stored", () => {
    // A certificate over `text`, issued as inkprint issues one, by a test key.
    const issuer = generateKeyPairSync("ed25519");
    const issuerKey = ok(
      publicKeyBody(
        new TextEncoder().encode(
          issuer.publicKey.export({ type: "spki", format: "pem" }).toString(),
        ),
      ),
    );
    const ID = "5e5e5e5e-0000-4000-8000-000000000001";
    function certified(text: string, excerpt: string | null) {
      const canonical = inkprintCanonicalText(text);
      const [row] = evidenceRows();
      const [receipt] = certificateReceipts();
      if (!row || !receipt) throw new Error("golden rows");
      return certificatesCheck({
        evidence: [{ ...row, certificateId: ID, excerpt }],
        receipts: [
          {
            ...receipt,
            ref: ID,
            hash: sha256Hex(canonical),
            signature: sign(null, Buffer.from(canonical, "utf8"), issuer.privateKey).toString(
              "base64",
            ),
            payload: { text, key: "k" },
          },
        ],
        answer: ok({
          results: [
            {
              certificate_id: ID,
              valid: true,
              checks: { signature: true, hash: true },
              reason: null,
            },
          ],
        }),
        key: issuerKey,
      });
    }
    const QUALIFIED = `${"Fee schedule. ".repeat(20)}Fees are reduced for micro entities only if they file electronically.`;

    it("passes the exact first 400 characters", () => {
      expect(QUALIFIED.length).toBeGreaterThan(300);
      expectState(certified(QUALIFIED, QUALIFIED.slice(0, 400)), "pass");
    });

    it("fails a shorter prefix that drops a qualifier (a meaning-changing truncation)", () => {
      const dropped = QUALIFIED.replace(" only if they file electronically.", "");
      expect(QUALIFIED.startsWith(dropped)).toBe(true);
      const c = certified(QUALIFIED, dropped);
      expectState(c, "fail");
      expect(c?.detail).toContain("excerpt");
    });

    it("passes an astral character cut at 400, which Postgres stores as U+FFFD", () => {
      const text = `${"a".repeat(399)}😀 and the rest`;
      expectState(certified(text, `${"a".repeat(399)}\ufffd`), "pass");
    });

    it("fails a certified row that shows no excerpt", () => {
      expectState(certified(QUALIFIED, null), "fail");
    });
  });

  it("fails two evidence rows that name one certificate (inkprint issues one id per item)", () => {
    const rows = evidenceRows();
    const first = rows[0];
    if (!first) throw new Error("golden rows");
    const duplicated = [
      ...rows,
      {
        ...first,
        id: "e0000000-0000-4000-8000-000000000009",
        stableId: "w-dup",
        excerpt: "edited",
      },
    ];
    const c = check({ evidence: duplicated });
    expectState(c, "fail");
    expect(c?.items?.find((x) => x.ref === first.certificateId)?.detail).toContain(
      "evidence rows name this one certificate",
    );
  });

  it("fails certificate receipts that name no certificate, even with no certified row", () => {
    const [receipt] = certificateReceipts();
    if (!receipt) throw new Error("golden receipts");
    const c = certificatesCheck({
      evidence: [],
      receipts: [{ ...receipt, ref: null }],
      answer: null,
      key: null,
    });
    expectState(c, "fail");
  });

  it("is not a check at all for a dossier with no certified evidence", () => {
    expect(certificatesCheck({ evidence: [], receipts: [], answer: null, key: null })).toBeNull();
    const uncertified = evidenceRows().map((e) => ({ ...e, certificateId: null }));
    expect(
      certificatesCheck({ evidence: uncertified, receipts: [], answer: null, key: null }),
    ).toBeNull();
  });
});

describe("transcript", () => {
  const live = () => ok(structuredClone(TRANSCRIPT));
  const key = () => ok(RECEIPT_KEY);
  const check = (
    receipt: StoredReceipt = transcriptReceipt(),
    answer: GatewayResult<typeof TRANSCRIPT> = live(),
    k: GatewayResult<typeof RECEIPT_KEY> | null = key(),
  ) =>
    transcriptCheck({
      dossier: DOSSIER,
      envelope: envelopeReceipt(),
      items: [{ receipt, live: answer }],
      key: k,
    });
  const many = (
    items: { receipt: StoredReceipt; live: GatewayResult<typeof TRANSCRIPT> | null }[],
    k: GatewayResult<typeof RECEIPT_KEY> | null = key(),
    over: { dossier?: typeof DOSSIER; envelope?: StoredReceipt | null } = {},
  ) =>
    transcriptCheck({
      dossier: over.dossier ?? DOSSIER,
      envelope: over.envelope === undefined ? envelopeReceipt() : over.envelope,
      items,
      key: k,
    });

  it("passes a real paper-trail signature over the re-fetched transcript", () => {
    const c = check();
    expect(c).toMatchObject({ name: "transcript", state: "pass" });
    expect(c?.detail).toContain("Ed25519");
  });

  it.each([
    ["the stored verdict", ["payload", "verdict"], "FALSE"],
    ["the stored confidence", ["payload", "confidence"], 0.9],
    ["a stored argument", ["payload", "rounds", 0, "argument_md"], "edited"],
    ["the stored hash", ["hash"], "0".repeat(64)],
  ] as const)("fails a tampered transcript: %s", (_what, path, value) => {
    expectState(check(edit(transcriptReceipt(), [...path], value)), "fail");
  });

  it("fails a round confidence the hash does not cover but the signature does", () => {
    const tampered = edit(transcriptReceipt(), ["payload", "rounds", 0, "confidence"], 0.5);
    const answer = ok(edit(TRANSCRIPT, ["rounds", 0, "confidence"], 0.5));
    expectState(check(tampered, answer), "fail");
  });

  it("fails when paper-trail now serves a different transcript", () => {
    expectState(check(transcriptReceipt(), ok(edit(TRANSCRIPT, ["confidence"], 0.83))), "fail");
  });

  it("fails when paper-trail now reports another hash", () => {
    expectState(
      check(transcriptReceipt(), ok(edit(TRANSCRIPT, ["transcript_hash"], "1".repeat(64)))),
      "fail",
    );
  });

  it("fails when paper-trail answers for another debate", () => {
    const other = "11111111-2222-4333-8444-555555555555";
    expectState(check(transcriptReceipt(), ok(edit(TRANSCRIPT, ["debate_id"], other))), "fail");
  });

  it("fails a signature that is not paper-trail's", () => {
    const forged = edit(transcriptReceipt(), ["signature"], `${"A".repeat(86)}==`);
    expectState(check(forged), "fail");
  });

  it("fails against any key but paper-trail's (the dossier never supplies the key)", () => {
    const k = ok({ alg: "Ed25519", public_key: otherKeyPem() });
    expectState(check(transcriptReceipt(), live(), k), "fail");
  });

  it("fails a key that is not Ed25519", () => {
    expectState(check(transcriptReceipt(), live(), ok({ ...RECEIPT_KEY, alg: "RS256" })), "fail");
  });

  it("fails an unsigned transcript: its origin cannot be proven", () => {
    const c = check(edit(transcriptReceipt(), ["signature"], null));
    expectState(c, "fail");
    expect(c?.detail).toContain("unsigned");
  });

  it.each([
    ["no debate id", ["ref"], null],
    ["no hash", ["hash"], null],
    ["a payload that is not a transcript", ["payload"], { debate_id: "x" }],
    [
      "a payload for another debate",
      ["payload", "debate_id"],
      "11111111-2222-4333-8444-555555555555",
    ],
  ] as const)("fails a receipt with %s", (_what, path, value) => {
    expectState(check(edit(transcriptReceipt(), [...path], value)), "fail");
  });

  it.each(OUTAGES)("is unavailable, never a pass, when paper-trail is out: %s", (_why, outage) => {
    const c = check(transcriptReceipt(), outage);
    expectState(c, "unavailable");
  });

  it.each(OUTAGES)(
    "is unavailable when paper-trail's key cannot be fetched: %s",
    (_why, outage) => {
      expectState(check(transcriptReceipt(), live(), outage), "unavailable");
    },
  );

  it("fails when paper-trail no longer has the debate (404)", () => {
    expectState(check(transcriptReceipt(), failed("downstream_error", 404)), "fail");
  });

  it("fails when paper-trail publishes no key (404: signing is off)", () => {
    expectState(check(transcriptReceipt(), live(), failed("downstream_error", 404)), "fail");
  });

  it("a tampered transcript fails even while paper-trail is out", () => {
    const tampered = edit(transcriptReceipt(), ["payload", "verdict"], "FALSE");
    expectState(check(tampered, failed("asleep", 504), failed("asleep", 504)), "fail");
  });

  it("a forged signature fails even while the transcript cannot be re-fetched", () => {
    const forged = edit(transcriptReceipt(), ["signature"], `${"A".repeat(86)}==`);
    expectState(check(forged, failed("asleep", 504)), "fail");
  });

  it("is unavailable, not a pass, when the transcript or the key was not fetched", () => {
    expectState(many([{ receipt: transcriptReceipt(), live: null }]), "unavailable");
    expectState(many([{ receipt: transcriptReceipt(), live: live() }], null), "unavailable");
  });

  it("checks each transcript receipt and reports the worst", () => {
    const other = edit(transcriptReceipt(), ["payload", "verdict"], "FALSE");
    const c = many([
      { receipt: transcriptReceipt(), live: live() },
      { receipt: other, live: live() },
    ]);
    expectState(c, "fail");
    expect(c?.items?.map((i) => i.state)).toEqual(["pass", "fail"]);
    const both = many([
      { receipt: transcriptReceipt(), live: live() },
      { receipt: transcriptReceipt(), live: live() },
    ]);
    expectState(both, "pass");
  });

  it("fails, never throws, on a transcript with no signed form (Python could not encode it)", () => {
    const lone = String.fromCharCode(0xd800);
    const stored = edit(transcriptReceipt(), ["payload", "rounds", 0, "argument_md"], lone);
    expect(() => check(stored)).not.toThrow();
    expectState(check(stored), "fail");
    const huge = ok(edit(TRANSCRIPT, ["rounds", 0, "round"], 2 ** 60));
    expect(() => check(transcriptReceipt(), huge)).not.toThrow();
    expectState(check(transcriptReceipt(), huge), "fail");
  });

  describe("binds what the page shows to the verified transcript", () => {
    it.each([
      ["the verdict", { verdict: "FALSE" as const }],
      ["the confidence", { confidence: "0.83" }],
      ["the claim", { claim: "The USPTO basic filing fee is $350." }],
      ["no verdict at all", { verdict: null }],
    ])("fails when the dossier shows another %s than the signed transcript", (_what, change) => {
      const c = many([{ receipt: transcriptReceipt(), live: live() }], key(), {
        dossier: { ...DOSSIER, ...change },
      });
      expectState(c, "fail");
      expect(c?.detail).toContain("the dossier shows");
    });

    it("binds the transcript the envelope names when there are several", () => {
      const otherId = "11111111-2222-4333-8444-555555555555";
      const other = edit(
        edit(transcriptReceipt(), ["ref"], otherId),
        ["payload", "debate_id"],
        otherId,
      );
      // The other debate's transcript does not verify either way, but only the named one is bound.
      const c = many([
        { receipt: other, live: ok(edit(TRANSCRIPT, ["debate_id"], otherId)) },
        { receipt: transcriptReceipt(), live: live() },
      ]);
      expect(c?.items?.[1]?.state).toBe("pass");
      const page = many(
        [
          { receipt: other, live: ok(edit(TRANSCRIPT, ["debate_id"], otherId)) },
          { receipt: transcriptReceipt(), live: live() },
        ],
        key(),
        { dossier: { ...DOSSIER, verdict: "FALSE" } },
      );
      expect(page?.items?.[1]?.state).toBe("fail");
    });

    it("binds the latest transcript when there is no envelope", () => {
      const c = many([{ receipt: transcriptReceipt(), live: live() }], key(), {
        envelope: null,
        dossier: { ...DOSSIER, verdict: "INCONCLUSIVE" },
      });
      expectState(c, "fail");
    });
  });

  it("fails when the dossier shows a verdict but holds no transcript receipt", () => {
    expectState(many([]), "fail");
  });

  it("fails a succeeded dossier that holds no transcript receipt (Ruling AA)", () => {
    const c = many([], null, { dossier: { ...DOSSIER, verdict: null, confidence: null } });
    expectState(c, "fail");
    expect(c?.detail).toContain("no transcript receipt");
  });

  it("is not a check at all for an unfinished dossier with no transcript and no verdict", () => {
    const running = { ...DOSSIER, status: "running" as const, verdict: null, confidence: null };
    expect(many([], null, { dossier: running })).toBeNull();
  });
});

describe("envelope", () => {
  const inputs = (over: Partial<Parameters<typeof envelopeCheck>[0]> = {}) => ({
    dossier: DOSSIER,
    envelope: envelopeReceipt(),
    certificates: certificateReceipts(),
    transcripts: [transcriptReceipt()],
    perf: perfReceipt(),
    documents: documents(),
    evidence: evidenceRows(),
    envelopeStep: "ok" as const,
    key: ok(publicKeyBody()),
    ...over,
  });

  it("passes inkprint's real signature over the envelope, bound to the stored receipts", () => {
    const check = envelopeCheck(inputs());
    expect(check).toMatchObject({ name: "envelope", state: "pass" });
    expect(check?.detail).toContain("2 certificates");
  });

  it.each([
    ["the signature", ["signature"], `${"A".repeat(86)}==`],
    ["the payload's signature", ["payload", "envelope_signature"], `${"A".repeat(86)}==`],
    [
      "the manifest's signature",
      ["payload", "envelope_manifest", "signature", "value"],
      `${"A".repeat(86)}==`,
    ],
    ["the receipt hash", ["hash"], "0".repeat(64)],
    [
      "the manifest's bundle hash",
      ["payload", "envelope_manifest", "assertions", 4, "data", "hash"],
      "0".repeat(64),
    ],
    [
      "the manifest's debate hash",
      ["payload", "envelope_manifest", "assertions", 2, "data", "hash"],
      "0".repeat(64),
    ],
    [
      "the manifest's perf hash",
      ["payload", "envelope_manifest", "assertions", 3, "data", "hash"],
      "0".repeat(64),
    ],
    [
      "the manifest's ingredients",
      ["payload", "envelope_manifest", "assertions", 0, "data", "instance_id"],
      "urn:uuid:x",
    ],
    ["the issued_at", ["payload", "envelope_manifest", "issued_at"], "2026-10-20T08:27:42Z"],
    ["the signed perf hash", ["payload", "request", "perf_receipt_hash"], "8".repeat(64)],
    [
      "the signed audit digest",
      ["payload", "request", "metadata", "audit_digest_at_envelope"],
      "0".repeat(64),
    ],
    ["the envelope id", ["ref"], "11111111-2222-4333-8444-555555555555"],
    ["the payload", ["payload"], { envelope_id: "x" }],
  ] as const)("fails a tampered envelope receipt: %s", (_what, path, value) => {
    // Whatever field changes, the manifest hash, the bundle hash or the signature stops matching.
    const tampered = edit(envelopeReceipt(), [...path], value);
    expectState(envelopeCheck(inputs({ envelope: tampered })), "fail");
  });

  it.each([
    ["bundle hash", 4, "hash", "0".repeat(64), "bundle hash"],
    ["transcript hash", 2, "hash", "0".repeat(64), "transcript hash"],
    ["perf hash", 3, "hash", "0".repeat(64), "perf hash"],
    ["ingredient", 0, "instance_id", "urn:uuid:x", "ingredients"],
  ] as const)(
    "fails a manifest whose %s was rewritten even with bastion's own hash recomputed",
    (_what, index, key, value, why) => {
      // Someone who can write bastion's database can recompute bastion's own receipt hash; the
      // manifest must still agree with what inkprint signed.
      const tampered = edit(
        envelopeReceipt(),
        ["payload", "envelope_manifest", "assertions", index, "data", key],
        value,
      );
      const manifest = (tampered.payload as { envelope_manifest: Json }).envelope_manifest;
      const rehashed = { ...tampered, hash: sha256Hex(canonicalJson(manifest)) };
      const check = envelopeCheck(inputs({ envelope: rehashed }));
      expectState(check, "fail");
      expect(check?.detail).toContain(why);
    },
  );

  it("fails when the stored certificates are not the ones signed", () => {
    const extra = [
      ...certificateReceipts(),
      { ...certificateReceipts()[0], ref: "4d6e8f0a-2b4c-4d6e-8f0a-2b4c6d8e0f1a" } as StoredReceipt,
    ];
    expectState(envelopeCheck(inputs({ certificates: extra })), "fail");
    expectState(envelopeCheck(inputs({ certificates: certificateReceipts().slice(1) })), "fail");
  });

  it("fails when the stored transcript is not the one signed", () => {
    const other = edit(transcriptReceipt(), ["hash"], "0".repeat(64));
    expectState(envelopeCheck(inputs({ transcripts: [other] })), "fail");
    expectState(envelopeCheck(inputs({ transcripts: [] })), "fail");
  });

  it("fails when the stored transcript signature is not the one signed", () => {
    const other = edit(transcriptReceipt(), ["signature"], "x");
    expectState(envelopeCheck(inputs({ transcripts: [other] })), "fail");
  });

  it("fails when the stored perf receipt is not the one signed", () => {
    expectState(
      envelopeCheck(inputs({ perf: edit(perfReceipt(), ["hash"], "0".repeat(64)) })),
      "fail",
    );
    expectState(envelopeCheck(inputs({ perf: null })), "fail");
  });

  it("fails when the documents' graph hashes are not the ones signed", () => {
    const changed = edit(documents(), [0, "graphHash"], "1".repeat(64));
    expectState(envelopeCheck(inputs({ documents: changed })), "fail");
    expectState(envelopeCheck(inputs({ documents: [] })), "fail");
  });

  it("fails when the envelope is another dossier's", () => {
    const other = { ...DOSSIER, id: "11111111-2222-4333-8444-555555555555" };
    expectState(envelopeCheck(inputs({ dossier: other })), "fail");
    expectState(envelopeCheck(inputs({ dossier: { ...DOSSIER, requestId: "req-other" } })), "fail");
  });

  it("fails against any key but inkprint's", () => {
    const key = ok(publicKeyBody(new TextEncoder().encode(otherKeyPem())));
    expectState(envelopeCheck(inputs({ key })), "fail");
  });

  it.each(OUTAGES)(
    "is unavailable, never a pass, when inkprint's key cannot be fetched: %s",
    (_why, outage) => {
      expectState(envelopeCheck(inputs({ key: outage })), "unavailable");
    },
  );

  it("fails when inkprint publishes no key (404)", () => {
    expectState(envelopeCheck(inputs({ key: failed("downstream_error", 404) })), "fail");
  });

  it("a tampered envelope fails even while inkprint is out", () => {
    const tampered = edit(
      envelopeReceipt(),
      ["payload", "request", "perf_receipt_hash"],
      "8".repeat(64),
    );
    expectState(envelopeCheck(inputs({ envelope: tampered, key: failed("asleep", 504) })), "fail");
  });

  it("fails, never throws, on an envelope with no signed form", () => {
    const lone = String.fromCharCode(0xdc00);
    const tampered = edit(envelopeReceipt(), ["payload", "request", "metadata", "debate_id"], lone);
    expect(() => envelopeCheck(inputs({ envelope: tampered }))).not.toThrow();
    expectState(envelopeCheck(inputs({ envelope: tampered })), "fail");
  });

  it("fails when the dossier names an envelope but holds no envelope receipt (Ruling Y)", () => {
    const c = envelopeCheck(inputs({ envelope: null }));
    expectState(c, "fail");
    expect(c?.detail).toContain("no envelope receipt");
  });

  it("fails when the dossier names another envelope than the stored one, or none", () => {
    const other = "11111111-2222-4333-8444-555555555555";
    expectState(envelopeCheck(inputs({ dossier: { ...DOSSIER, envelopeId: other } })), "fail");
    expectState(envelopeCheck(inputs({ dossier: { ...DOSSIER, envelopeId: null } })), "fail");
  });

  describe("certified evidence implies an envelope, whatever envelope_id says (Ruling AA)", () => {
    it("fails a succeeded dossier whose certificates no envelope binds", () => {
      const dossier = { ...DOSSIER, envelopeId: null };
      const c = envelopeCheck(inputs({ envelope: null, dossier, envelopeStep: "ok" }));
      expectState(c, "fail");
      expect(c?.detail).toContain("no envelope");
      expectState(envelopeCheck(inputs({ envelope: null, dossier, envelopeStep: null })), "fail");
    });

    it.each(["pending", "running"] as const)(
      "is unavailable, never a pass, while a %s dossier has no envelope yet",
      (status) => {
        const dossier = { ...DOSSIER, status, envelopeId: null };
        expectState(envelopeCheck(inputs({ envelope: null, dossier })), "unavailable");
      },
    );

    describe("a failed dossier is judged by its envelope step (Ruling AB)", () => {
      const failedDossier = { ...DOSSIER, status: "failed" as const, envelopeId: null };

      it.each(["pending", "error", "skipped"] as const)(
        "envelope step %s: the dossier failed before sealing — unavailable, never a pass",
        (envelopeStep) => {
          const c = envelopeCheck(inputs({ envelope: null, dossier: failedDossier, envelopeStep }));
          expectState(c, "unavailable");
          expect(c?.detail).toBe("the dossier failed before sealing");
        },
      );

      it("envelope step ok but no envelope receipt: fail", () => {
        const c = envelopeCheck(
          inputs({ envelope: null, dossier: failedDossier, envelopeStep: "ok" }),
        );
        expectState(c, "fail");
        expect(c?.detail).toContain("no envelope receipt");
      });
    });
  });

  it("is not a check at all for a dossier with no envelope, none named and nothing certified", () => {
    const dossier = { ...DOSSIER, envelopeId: null };
    const uncertified = evidenceRows().map((e) => ({ ...e, certificateId: null }));
    expect(envelopeCheck(inputs({ envelope: null, dossier, evidence: uncertified }))).toBeNull();
    expect(envelopeCheck(inputs({ envelope: null, dossier, evidence: [] }))).toBeNull();
  });
});

describe("perf", () => {
  it("passes when the stored receipt recomputes to its hash", () => {
    expect(perfCheck(DOSSIER, perfReceipt())).toMatchObject({ name: "perf", state: "pass" });
  });

  it.each([
    ["a query's calls", ["payload", "services", 0, "queries", 0, "calls"], 4],
    ["a suggestion", ["payload", "services", 0, "queries", 0, "suggestions", 0, "sql"], null],
    ["a service's error", ["payload", "services", 1, "error"], "500"],
    ["the hash", ["hash"], "0".repeat(64)],
    ["the dossier id", ["payload", "dossier_id"], "11111111-2222-4333-8444-555555555555"],
    ["the request id", ["payload", "request_id"], "req-other"],
    ["an undeclared field", ["payload", "note"], "unhashed"],
    ["a service that is not one", ["payload", "services", 0, "service"], "bastion"],
    ["no hash", ["hash"], null],
    ["no payload", ["payload"], null],
  ] as const)("fails a tampered perf receipt: %s", (_what, path, value) => {
    expectState(perfCheck(DOSSIER, edit(perfReceipt(), [...path], value)), "fail");
  });

  it("fails a succeeded dossier that holds no perf receipt (Ruling Y)", () => {
    const c = perfCheck(DOSSIER, null);
    expectState(c, "fail");
    expect(c?.detail).toContain("no perf receipt");
  });

  it("is not a check at all for an unfinished dossier without a perf receipt", () => {
    for (const status of ["pending", "running", "failed"] as const) {
      expect(perfCheck({ ...DOSSIER, status }, null)).toBeNull();
    }
  });
});

describe("audit", () => {
  type Run = Parameters<typeof auditCheck>[0];
  const audit = (receipt = auditReceipt(), events = eventsUpTo(GOLDEN.recordUpTo)) => ({
    receipt,
    events,
  });
  const envelope = (
    receipt = envelopeReceipt(),
    events = eventsUpTo(GOLDEN.envelopeUpTo),
    signature: Check["state"] = "pass",
  ) => ({ receipt, events, signature });
  const run = (over: Partial<Run> = {}) =>
    auditCheck({ dossier: DOSSIER, audit: audit(), envelope: envelope(), ...over });

  it("reads the bounds the digests are recomputed over", () => {
    expect(auditBound(auditReceipt())).toBe(GOLDEN.recordUpTo);
    expect(envelopeAuditBound(envelopeReceipt())).toBe(GOLDEN.envelopeUpTo);
    expect(auditBound(edit(auditReceipt(), ["payload"], null))).toBeNull();
    expect(
      envelopeAuditBound(
        edit(envelopeReceipt(), ["payload", "request", "metadata", "audit_up_to"], "8a"),
      ),
    ).toBeNull();
  });

  it("passes when both the record receipt and the envelope's signed digest recompute", () => {
    const check = run();
    expect(check).toMatchObject({ name: "audit", state: "pass" });
    expect(check?.detail).toContain(`#${GOLDEN.recordUpTo}`);
  });

  it("passes on the record receipt alone, and on a verified envelope's digest alone", () => {
    expectState(run({ envelope: null }), "pass");
    expectState(run({ audit: null, dossier: { ...DOSSIER, status: "running" } }), "pass");
  });

  describe("the envelope's digest counts only once the envelope's signature verified (Ruling Y)", () => {
    it("fails when the envelope check failed: the digest is not proven signed", () => {
      const c = run({
        envelope: envelope(envelopeReceipt(), eventsUpTo(GOLDEN.envelopeUpTo), "fail"),
      });
      expectState(c, "fail");
      expect(c?.detail).toContain("not proven signed");
    });

    it("is unavailable while the envelope's signature could not be checked", () => {
      const c = run({
        envelope: envelope(envelopeReceipt(), eventsUpTo(GOLDEN.envelopeUpTo), "unavailable"),
      });
      expectState(c, "unavailable");
    });

    it("a digest that does not recompute fails whatever the envelope check said", () => {
      const events = edit(eventsUpTo(GOLDEN.envelopeUpTo), [0, "service"], "inkprint");
      expectState(run({ envelope: envelope(envelopeReceipt(), events, "unavailable") }), "fail");
    });
  });

  it("fails when an event within the bound is gone", () => {
    const events = eventsUpTo(GOLDEN.recordUpTo).filter((e) => e.id !== 5);
    expectState(run({ audit: audit(auditReceipt(), events), envelope: null }), "fail");
  });

  it("fails when an event was rewritten", () => {
    const events = edit(eventsUpTo(GOLDEN.recordUpTo), [1, "action"], "dossier.stage.error");
    expectState(run({ audit: audit(auditReceipt(), events), envelope: null }), "fail");
  });

  it("fails when the envelope's signed digest does not recompute", () => {
    const events = edit(eventsUpTo(GOLDEN.envelopeUpTo), [0, "service"], "inkprint");
    expectState(run({ envelope: envelope(envelopeReceipt(), events) }), "fail");
  });

  it.each([
    ["the digest", ["hash"], "0".repeat(64)],
    ["no digest", ["hash"], null],
    ["the bound", ["payload", "up_to_event_id"], 11],
    ["the count", ["payload", "event_count"], 4],
    ["the request id", ["payload", "request_id"], "req-other"],
    ["a payload that is not an audit receipt", ["payload"], { request_id: DOSSIER.requestId }],
  ] as const)("fails a tampered audit receipt: %s", (_what, path, value) => {
    expectState(
      run({ audit: audit(edit(auditReceipt(), [...path], value)), envelope: null }),
      "fail",
    );
  });

  it("fails a record receipt over no events at all (Ruling Y)", () => {
    const empty = edit(
      edit(edit(auditReceipt(), ["payload", "up_to_event_id"], 0), ["payload", "event_count"], 0),
      ["hash"],
      auditDigest([]),
    );
    const c = run({ audit: audit(empty, []), envelope: null });
    expectState(c, "fail");
    expect(c?.detail).toContain("no events");
  });

  it("fails a succeeded dossier that holds no audit receipt (Ruling Y)", () => {
    const c = run({ audit: null });
    expectState(c, "fail");
    expect(c?.detail).toContain("no audit receipt");
  });

  it("fails an envelope whose signed request id is another's", () => {
    const other = edit(
      envelopeReceipt(),
      ["payload", "request", "metadata", "request_id"],
      "req-other",
    );
    expectState(
      run({ audit: null, envelope: envelope(other), dossier: { ...DOSSIER, status: "running" } }),
      "fail",
    );
  });

  it("is not a check at all for an unfinished dossier with neither receipt", () => {
    expect(
      run({ audit: null, envelope: null, dossier: { ...DOSSIER, status: "running" } }),
    ).toBeNull();
  });

  it("the golden events are what the digests cover", () => {
    expect(EVENTS.map((e) => e.id)).toEqual([3, 5, 8, 11, 12]);
  });
});

describe("documents", () => {
  const graphs = (answer: GatewayResult<Graph> = ok(GRAPH)) =>
    new Map(documents().map((d) => [d.documentId, answer]));
  const upload = () => documents().map((d) => ({ ...d, kind: "upload" as const }));

  it("passes when inkthread still serves the stored graph hash", () => {
    const check = documentsCheck(documents(), graphs());
    expect(check).toMatchObject({ name: "documents", state: "pass" });
    expect(check?.items?.[0]).toMatchObject({ ref: documents()[0]?.documentId, state: "pass" });
  });

  it("fails when the graph hash changed", () => {
    const changed = ok(edit(GRAPH, ["provenance", "graph_hash"], "1".repeat(64)));
    expectState(documentsCheck(documents(), graphs(changed)), "fail");
  });

  it("fails when the document's bytes changed", () => {
    const changed = ok(edit(GRAPH, ["document", "sha256"], "1".repeat(64)));
    expectState(documentsCheck(documents(), graphs(changed)), "fail");
  });

  it.each([404, 410])(
    "an upload inkthread no longer keeps (%i) is expired, not failed (Review focus #5)",
    (status) => {
      const gone = failed("downstream_error", status, { detail: "upload_not_kept" });
      const check = documentsCheck(upload(), graphs(gone));
      expectState(check, "expired");
      expect(check?.detail).toContain("DR-0029");
    },
  );

  it("a sample inkthread no longer has (404) fails: samples never expire", () => {
    expectState(documentsCheck(documents(), graphs(failed("downstream_error", 404))), "fail");
  });

  it.each(OUTAGES)("is unavailable, never a pass, when inkthread is out: %s", (_why, outage) => {
    expectState(documentsCheck(documents(), graphs(outage)), "unavailable");
    expectState(documentsCheck(upload(), graphs(outage)), "unavailable");
  });

  it("aggregates: fail over unavailable over expired over pass", () => {
    const docs = [
      ...documents(),
      {
        ...documents()[0],
        documentId: "doc-up",
        kind: "upload" as const,
      } as typeof documents extends () => (infer D)[] ? D : never,
      { ...documents()[0], documentId: "doc-out" } as ReturnType<typeof documents>[number],
    ];
    const answers = new Map<string, GatewayResult<Graph>>([
      [documents()[0]?.documentId ?? "", ok(GRAPH)],
      ["doc-up", failed("downstream_error", 404)],
      ["doc-out", failed("asleep", 504)],
    ]);
    expectState(documentsCheck(docs.slice(0, 2), answers), "expired");
    expectState(documentsCheck(docs, answers), "unavailable");
    answers.set(
      documents()[0]?.documentId ?? "",
      ok(edit(GRAPH, ["provenance", "graph_hash"], "1".repeat(64))),
    );
    expectState(documentsCheck(docs, answers), "fail");
  });

  it("checks only documents that were read (have a graph hash)", () => {
    const unread = documents().map((d) => ({ ...d, graphHash: null }));
    expect(documentsCheck(unread, new Map())).toBeNull();
    expect(documentsCheck([], new Map())).toBeNull();
  });

  it("is unavailable for a read document whose answer is missing", () => {
    expectState(documentsCheck(documents(), new Map()), "unavailable");
  });
});
