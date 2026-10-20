import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Graph } from "@/capabilities/inkthread";
import type { StoredReceipt } from "@/dossier/receipts";
import {
  auditBound,
  auditCheck,
  type Check,
  certificatesCheck,
  documentsCheck,
  envelopeAuditBound,
  envelopeCheck,
  perfCheck,
  sendableCertificates,
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
  const sent = () => sendableCertificates(certificateReceipts());

  it("sends each certificate id with its full stored text", () => {
    expect(sent()).toEqual(
      GOLDEN.certificates.map((c) => ({ certificate_id: c.id, text: c.text })),
    );
  });

  it("passes when inkprint verifies every certificate against its text", () => {
    const check = certificatesCheck(certificateReceipts(), ok(verifyAllValid()));
    expect(check).toMatchObject({ name: "certificates", state: "pass" });
    expect(check?.detail).toContain("2 of 2");
    expect(check?.items?.map((i) => [i.ref, i.state])).toEqual(
      GOLDEN.certificates.map((c) => [c.id, "pass"]),
    );
  });

  it("fails a certificate whose text no longer matches, naming the failed checks", () => {
    const answer = edit(verifyAllValid(), ["results", 1], {
      certificate_id: GOLDEN.certificates[1]?.id,
      valid: false,
      checks: { signature: true, hash: true, simhash: false, embedding: false },
      reason: null,
    });
    const check = certificatesCheck(certificateReceipts(), ok(answer));
    expectState(check, "fail");
    expect(check?.items?.[1]).toMatchObject({ state: "fail" });
    expect(check?.items?.[1]?.detail).toContain("simhash, embedding");
    expect(check?.items?.[0]?.state).toBe("pass");
  });

  it("fails a certificate inkprint does not know", () => {
    const answer = edit(verifyAllValid(), ["results", 0], {
      certificate_id: GOLDEN.certificates[0]?.id,
      valid: false,
      checks: {},
      reason: "unknown_certificate",
    });
    const check = certificatesCheck(certificateReceipts(), ok(answer));
    expectState(check, "fail");
    expect(check?.items?.[0]?.detail).toContain("unknown_certificate");
  });

  it("fails a certificate inkprint returned no result for", () => {
    const answer = { results: verifyAllValid().results.slice(0, 1) };
    expectState(certificatesCheck(certificateReceipts(), ok(answer)), "fail");
  });

  it("fails a receipt with no stored text, and still checks the others", () => {
    const receipts = certificateReceipts();
    const broken = edit(receipts, [0, "payload"], { key: "w-x" });
    expect(sendableCertificates(broken)).toHaveLength(1);
    const check = certificatesCheck(broken, ok(verifyAllValid()));
    expectState(check, "fail");
    expect(check?.items?.map((i) => i.state)).toEqual(["fail", "pass"]);
  });

  it("fails a receipt with no certificate id", () => {
    const broken = edit(certificateReceipts(), [1, "ref"], null);
    const check = certificatesCheck(broken, ok(verifyAllValid()));
    expectState(check, "fail");
  });

  it.each(OUTAGES)("is unavailable, never a pass, when inkprint is out: %s", (_why, outage) => {
    expectState(certificatesCheck(certificateReceipts(), outage), "unavailable");
  });

  it("says when to retry after the gateway's rate limit", () => {
    const check = certificatesCheck(
      certificateReceipts(),
      failed("rate_limited", 429, { retryAfterS: 12 }),
    );
    expect(check?.detail).toContain("12 s");
  });

  it("fails when the stored receipt cannot even be sent (invalid input)", () => {
    const check = certificatesCheck(
      certificateReceipts(),
      failed("invalid_input", 422, { detail: "items.0.certificate_id: Invalid UUID" }),
    );
    expectState(check, "fail");
  });

  it("an unsent receipt fails even while inkprint is out (a proven fail beats unavailable)", () => {
    const broken = edit(certificateReceipts(), [0, "payload"], null);
    expectState(certificatesCheck(broken, failed("asleep", 504)), "fail");
  });

  it("is not a check at all for a dossier with no certificates", () => {
    expect(certificatesCheck([], null)).toBeNull();
  });
});

describe("transcript", () => {
  const live = () => ok(structuredClone(TRANSCRIPT));
  const key = () => ok(RECEIPT_KEY);
  const check = (
    receipt: StoredReceipt = transcriptReceipt(),
    answer: GatewayResult<typeof TRANSCRIPT> = live(),
    k: GatewayResult<typeof RECEIPT_KEY> | null = key(),
  ) => transcriptCheck([{ receipt, live: answer }], k);

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
    expectState(
      transcriptCheck([{ receipt: transcriptReceipt(), live: null }], key()),
      "unavailable",
    );
    expectState(
      transcriptCheck([{ receipt: transcriptReceipt(), live: live() }], null),
      "unavailable",
    );
  });

  it("checks each transcript receipt and reports the worst", () => {
    const other = edit(transcriptReceipt(), ["payload", "verdict"], "FALSE");
    const c = transcriptCheck(
      [
        { receipt: transcriptReceipt(), live: live() },
        { receipt: other, live: live() },
      ],
      key(),
    );
    expectState(c, "fail");
    expect(c?.items?.map((i) => i.state)).toEqual(["pass", "fail"]);
    const both = transcriptCheck(
      [
        { receipt: transcriptReceipt(), live: live() },
        { receipt: transcriptReceipt(), live: live() },
      ],
      key(),
    );
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

  it("is not a check at all for a dossier with no transcript", () => {
    expect(transcriptCheck([], null)).toBeNull();
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

  it("is not a check at all for a dossier with no envelope", () => {
    expect(envelopeCheck(inputs({ envelope: null }))).toBeNull();
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

  it("is not a check at all without a perf receipt", () => {
    expect(perfCheck(DOSSIER, null)).toBeNull();
  });
});

describe("audit", () => {
  const audit = (receipt = auditReceipt(), events = eventsUpTo(GOLDEN.recordUpTo)) => ({
    receipt,
    events,
  });
  const envelope = (receipt = envelopeReceipt(), events = eventsUpTo(GOLDEN.envelopeUpTo)) => ({
    receipt,
    events,
  });

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
    const check = auditCheck({
      requestId: DOSSIER.requestId,
      audit: audit(),
      envelope: envelope(),
    });
    expect(check).toMatchObject({ name: "audit", state: "pass" });
    expect(check?.detail).toContain(`#${GOLDEN.recordUpTo}`);
  });

  it("passes on the record receipt alone, and on the envelope's digest alone", () => {
    expectState(
      auditCheck({ requestId: DOSSIER.requestId, audit: audit(), envelope: null }),
      "pass",
    );
    expectState(
      auditCheck({ requestId: DOSSIER.requestId, audit: null, envelope: envelope() }),
      "pass",
    );
  });

  it("fails when an event within the bound is gone", () => {
    const events = eventsUpTo(GOLDEN.recordUpTo).filter((e) => e.id !== 5);
    expectState(
      auditCheck({
        requestId: DOSSIER.requestId,
        audit: audit(auditReceipt(), events),
        envelope: null,
      }),
      "fail",
    );
  });

  it("fails when an event was rewritten", () => {
    const events = edit(eventsUpTo(GOLDEN.recordUpTo), [1, "action"], "dossier.stage.error");
    expectState(
      auditCheck({
        requestId: DOSSIER.requestId,
        audit: audit(auditReceipt(), events),
        envelope: null,
      }),
      "fail",
    );
  });

  it("fails when the envelope's signed digest does not recompute", () => {
    const events = edit(eventsUpTo(GOLDEN.envelopeUpTo), [0, "service"], "inkprint");
    expectState(
      auditCheck({
        requestId: DOSSIER.requestId,
        audit: audit(),
        envelope: envelope(envelopeReceipt(), events),
      }),
      "fail",
    );
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
      auditCheck({
        requestId: DOSSIER.requestId,
        audit: audit(edit(auditReceipt(), [...path], value)),
        envelope: null,
      }),
      "fail",
    );
  });

  it("fails an envelope whose signed request id is another's", () => {
    const other = edit(
      envelopeReceipt(),
      ["payload", "request", "metadata", "request_id"],
      "req-other",
    );
    expectState(
      auditCheck({ requestId: DOSSIER.requestId, audit: null, envelope: envelope(other) }),
      "fail",
    );
  });

  it("is not a check at all with neither an audit receipt nor an envelope", () => {
    expect(auditCheck({ requestId: DOSSIER.requestId, audit: null, envelope: null })).toBeNull();
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
