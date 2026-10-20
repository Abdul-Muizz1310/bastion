import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inkprint } from "@/capabilities/inkprint";
import { paperTrail } from "@/capabilities/paper-trail";
import {
  envelopeBundleJson,
  transcriptRenderJson,
  transcriptSignedJson,
} from "@/dossier/issuer-forms";
import { verifyEd25519 } from "@/platform/ed25519";
import { sha256Hex } from "@/platform/sha256";

/**
 * The exact bytes each issuer signs (spec 21 §6.5), proven on fixtures produced by the issuers'
 * own code (contract-v2): paper-trail's render node and `GET /debates/{id}/transcript.json`
 * served through FastAPI, and inkprint's `POST /dossiers/envelope` (see
 * `tests/fixtures/receipts/generate/`). Each fixture is the HTTP body as the issuer sent it; JSON
 * parsing loses Python's int/float split, which these forms restore.
 */

const dir = resolve(__dirname, "../../fixtures/receipts");
const read = (path: string) => readFileSync(resolve(dir, path), "utf8");
const transcript = (name: string) =>
  paperTrail.transcript.output.parse(JSON.parse(read(`paper-trail/transcript-${name}.json`)));
const PT_KEY = paperTrail.receiptKey.output.parse(JSON.parse(read("paper-trail/receipt-key.json")));
const INK_PEM = read("inkprint/public-key.pem");

type EnvelopeFixture = {
  request: ReturnType<typeof inkprint.envelope.input.parse>;
  response: unknown;
};
const envelope = (name: string) => {
  const f = JSON.parse(read(`inkprint/envelope-${name}.json`)) as EnvelopeFixture;
  return { request: f.request, response: inkprint.envelope.output.parse(f.response) };
};

function manifestBundleHash(manifest: Record<string, unknown>): unknown {
  const assertions = manifest.assertions as { label: string; data: { hash: string } }[];
  return assertions.find((a) => a.label === "c2pa.hash.data")?.data.hash;
}

describe("paper-trail's transcript forms", () => {
  it.each(["a", "b", "legacy"])(
    "transcript %s: the signature verifies over the signed form",
    (name) => {
      const t = transcript(name);
      expect(t.signature).not.toBeNull();
      expect(
        verifyEd25519({
          publicKeyPem: PT_KEY.public_key,
          message: transcriptSignedJson(t),
          signature: t.signature ?? "",
        }),
      ).toBe(true);
    },
  );

  it.each(["a", "b"])(
    "transcript %s: the render node's hash is over rounds without confidence",
    (name) => {
      const t = transcript(name);
      expect(sha256Hex(transcriptRenderJson(t))).toBe(t.transcript_hash);
      expect(sha256Hex(transcriptSignedJson(t))).not.toBe(t.transcript_hash);
    },
  );

  it("a legacy debate's hash (computed by the route) is over the signed form", () => {
    const t = transcript("legacy");
    expect(sha256Hex(transcriptSignedJson(t))).toBe(t.transcript_hash);
  });

  it("writes confidence as a Python float: 1.0, and 5e-05 though the HTTP body says 0.00005", () => {
    expect(read("paper-trail/transcript-b.json")).toContain('"confidence":1.0');
    expect(transcriptSignedJson(transcript("b"))).toContain('"confidence":1.0,');
    expect(read("paper-trail/transcript-legacy.json")).toContain('"confidence":0.00005');
    expect(transcriptSignedJson(transcript("legacy"))).toContain('"confidence":5e-05,');
  });

  it("the signed form is exactly paper-trail's: sorted keys, no spaces, non-ASCII as itself", () => {
    const t = transcript("a");
    const signed = transcriptSignedJson(t);
    expect(
      signed.startsWith('{"claim":"The USPTO basic filing fee is $350 — “basic” only.",'),
    ).toBe(true);
    expect(signed).toContain(
      '{"argument_md":"Conceded for large entities.","citations":[],"confidence":null,"round":2,"side":"skeptic"}',
    );
    expect(transcriptRenderJson(t)).toContain(
      '{"argument_md":"Conceded for large entities.","citations":[],"round":2,"side":"skeptic"}',
    );
  });

  it.each([
    ["the verdict", { verdict: "FALSE" as const }],
    ["the confidence", { confidence: 0.83 }],
    ["the claim", { claim: "The USPTO basic filing fee is $351." }],
  ])("a transcript with %s changed no longer verifies or hashes", (_what, change) => {
    const t = { ...transcript("a"), ...change };
    expect(
      verifyEd25519({
        publicKeyPem: PT_KEY.public_key,
        message: transcriptSignedJson(t),
        signature: transcript("a").signature ?? "",
      }),
    ).toBe(false);
    expect(sha256Hex(transcriptRenderJson(t))).not.toBe(t.transcript_hash);
  });

  it("a changed round citation no longer verifies", () => {
    const t = transcript("a");
    const rounds = t.rounds.map((r, i) =>
      i === 0 ? { ...r, citations: r.citations.map((c) => ({ ...c, title: "edited" })) } : r,
    );
    expect(
      verifyEd25519({
        publicKeyPem: PT_KEY.public_key,
        message: transcriptSignedJson({ ...t, rounds }),
        signature: t.signature ?? "",
      }),
    ).toBe(false);
  });
});

describe("inkprint's envelope bundle", () => {
  it.each(["now", "whole-second", "golden"])(
    "envelope %s: the bundle hashes to the manifest's c2pa.hash.data and the signature verifies",
    (name) => {
      const { request, response } = envelope(name);
      const bundle = envelopeBundleJson({
        ...request,
        issued_at: String(response.envelope_manifest.issued_at),
      });
      expect(sha256Hex(bundle)).toBe(manifestBundleHash(response.envelope_manifest));
      expect(
        verifyEd25519({
          publicKeyPem: INK_PEM,
          message: bundle,
          signature: response.envelope_signature,
        }),
      ).toBe(true);
    },
  );

  it("signs the manifest's issued_at (+00:00), not created_at (which pydantic writes with Z)", () => {
    const { request, response } = envelope("whole-second");
    expect(response.envelope_manifest.issued_at).toBe("2026-10-20T09:30:11+00:00");
    expect(response.created_at).toBe("2026-10-20T09:30:11Z");
    const withCreatedAt = envelopeBundleJson({ ...request, issued_at: response.created_at });
    expect(
      verifyEd25519({
        publicKeyPem: INK_PEM,
        message: withCreatedAt,
        signature: response.envelope_signature,
      }),
    ).toBe(false);
  });

  it("is exactly inkprint's bytes: sorted keys at every level, cert ids in the order given", () => {
    const bundle = envelopeBundleJson({
      dossier_id: "d",
      evidence_cert_ids: ["c2", "c1"],
      debate_transcript_hash: "t",
      perf_receipt_hash: "p",
      metadata: { z: "1", a: "é" },
      issued_at: "i",
    });
    expect(bundle).toBe(
      '{"debate_transcript_hash":"t","dossier_id":"d","evidence_cert_ids":["c2","c1"],' +
        '"issued_at":"i","metadata":{"a":"é","z":"1"},"perf_receipt_hash":"p"}',
    );
  });

  it("writes absent metadata as an empty object, as inkprint does for None", () => {
    expect(
      envelopeBundleJson({
        dossier_id: "d",
        evidence_cert_ids: [],
        debate_transcript_hash: "t",
        perf_receipt_hash: "p",
        issued_at: "i",
      }),
    ).toContain('"metadata":{}');
  });

  it("a bundle with any field changed no longer verifies", () => {
    const { request, response } = envelope("now");
    const issued_at = String(response.envelope_manifest.issued_at);
    for (const changed of [
      { ...request, perf_receipt_hash: "8".repeat(64) },
      { ...request, evidence_cert_ids: [...request.evidence_cert_ids].reverse() },
      { ...request, metadata: { ...request.metadata, audit_up_to: "9" } },
    ]) {
      const bundle = envelopeBundleJson({ ...changed, issued_at });
      expect(
        verifyEd25519({
          publicKeyPem: INK_PEM,
          message: bundle,
          signature: response.envelope_signature,
        }),
      ).toBe(false);
    }
  });
});
