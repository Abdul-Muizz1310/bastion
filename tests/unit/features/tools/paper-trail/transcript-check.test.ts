import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReceiptKey, Transcript } from "@/capabilities/paper-trail";
import { checkTranscript } from "@/features/tools/paper-trail/transcript-check";

/**
 * paper-trail's receipt, checked live (spec 21 §5, §5.1 invariant 8): `transcript_hash` recomputed
 * from the rounds, the Ed25519 signature verified with paper-trail's published key — and nothing
 * that could not be checked ever reads as a pass. The fixtures are real paper-trail signings.
 */

const FIXTURES = resolve(__dirname, "../../../../fixtures/receipts/paper-trail");
const load = <T,>(name: string): T => JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8"));

const transcript = load<Transcript>("transcript-a.json");
const legacy = load<Transcript>("transcript-legacy.json");
const key = load<ReceiptKey>("receipt-key.json");
const ID = transcript.debate_id;

describe("checkTranscript", () => {
  it("passes a genuine transcript: hash recomputed, signature verified", () => {
    const check = checkTranscript(transcript, key, ID);
    expect(check.debateId).toBe(transcript.debate_id);
    expect(check.transcriptHash).toBe(transcript.transcript_hash);
    expect(check.hash).toEqual({ state: "pass", form: "render" });
    expect(check.signature.state).toBe("pass");
  });

  it("fails both when paper-trail answers with another debate's transcript", () => {
    const check = checkTranscript(transcript, key, "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d");
    expect(check.hash.state).toBe("fail");
    expect(check.signature).toMatchObject({ state: "fail", detail: expect.stringMatching(/another debate/) });
  });

  it("accepts a legacy debate whose hash paper-trail computed from the signed form", () => {
    expect(checkTranscript(legacy, key, legacy.debate_id).hash).toEqual({ state: "pass", form: "signed" });
  });

  it("fails both when a round is altered after signing", () => {
    const altered: Transcript = {
      ...transcript,
      rounds: transcript.rounds.map((r, i) => (i === 0 ? { ...r, argument_md: "edited" } : r)),
    };
    const check = checkTranscript(altered, key, ID);
    expect(check.hash.state).toBe("fail");
    expect(check.signature.state).toBe("fail");
  });

  it("fails the signature when the verdict is altered", () => {
    expect(checkTranscript({ ...transcript, verdict: "FALSE" }, key, ID).signature.state).toBe("fail");
  });

  it("calls an unsigned transcript unsigned, never a pass", () => {
    const check = checkTranscript({ ...transcript, signature: null, signature_alg: null }, key, ID);
    expect(check.signature.state).toBe("unsigned");
  });

  it("calls the signature unavailable when the key could not be fetched", () => {
    expect(checkTranscript(transcript, null, ID).signature.state).toBe("unavailable");
  });

  it("fails a key that is not Ed25519", () => {
    expect(checkTranscript(transcript, { ...key, alg: "RS256" }, ID).signature).toMatchObject({
      state: "fail",
    });
  });

  it("fails a signature checked against another key", () => {
    const other = {
      alg: "Ed25519",
      public_key:
        "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAXMaI647NsQacCo11kIyB17Zxg6g5fErNWUEceeQ3JUg=\n-----END PUBLIC KEY-----\n",
    };
    expect(checkTranscript(transcript, other, ID).signature.state).toBe("fail");
  });
});
