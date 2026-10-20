import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `verifyDossier` is wired to the real adapters and to the gateway (spec 21 §6.5): each issuer is
 * asked through `callCapability` with its free capability — `inkprint.verifyBatch`,
 * `paper-trail.transcript`, `paper-trail.receiptKey`, `inkprint.publicKey`, `inkthread.graph` —
 * under the caller's context, and the audit log is read through `requestEvents`.
 */

const m = vi.hoisted(() => ({
  callCapability: vi.fn(),
  listReceipts: vi.fn(),
  listEvidence: vi.fn(),
  listDocuments: vi.fn(),
  requestEvents: vi.fn(),
}));

vi.mock("@/platform/gateway/call", () => ({ callCapability: m.callCapability }));
vi.mock("@/dossier/receipts", () => ({ listReceipts: m.listReceipts }));
vi.mock("@/dossier/documents", () => ({ listDocuments: m.listDocuments }));
vi.mock("@/dossier/evidence", () => ({ listEvidence: m.listEvidence }));
vi.mock("@/platform/audit/request-events", () => ({ requestEvents: m.requestEvents }));

import { inkprint } from "@/capabilities/inkprint";
import { inkthread } from "@/capabilities/inkthread";
import { paperTrail } from "@/capabilities/paper-trail";
import { STAGES } from "@/dossier/stages";
import { verifyDossier } from "@/dossier/verify-live";
import type { CallContext } from "@/platform/gateway/call";
import { allReceipts, DOSSIER, documents, evidenceRows, GOLDEN, TRANSCRIPT } from "./verify-golden";

const CTX = { actor: "bastion", requestId: "req-verify-2" } as CallContext;
const STEPS = STAGES.map((stage) => ({ stage, status: "ok" as const }));

beforeEach(() => {
  m.callCapability
    .mockReset()
    .mockResolvedValue({ ok: false, error: "asleep", status: 504, requestId: "r" });
  m.listReceipts.mockReset().mockResolvedValue(allReceipts());
  m.listEvidence.mockReset().mockResolvedValue(evidenceRows());
  m.listDocuments.mockReset().mockResolvedValue(documents());
  m.requestEvents.mockReset().mockResolvedValue([]);
});

describe("verifyDossier (wired)", () => {
  it("reads the dossier's receipts, documents and events through the adapters", async () => {
    await verifyDossier(DOSSIER, CTX, STEPS);
    expect(m.listReceipts).toHaveBeenCalledWith(DOSSIER.id);
    expect(m.listEvidence).toHaveBeenCalledWith(DOSSIER.id);
    expect(m.listDocuments).toHaveBeenCalledWith(DOSSIER.id);
    expect(m.requestEvents).toHaveBeenCalledWith(DOSSIER.requestId, GOLDEN.recordUpTo);
  });

  it("asks each issuer through the gateway with its free capability and the caller's context", async () => {
    await verifyDossier(DOSSIER, CTX, STEPS);
    const calls = m.callCapability.mock.calls.map(([cap, input, ctx]) => [cap.id, input, ctx]);
    expect(calls).toEqual(
      expect.arrayContaining([
        [
          inkprint.verifyBatch.id,
          { items: GOLDEN.certificates.map((c) => ({ certificate_id: c.id })) },
          CTX,
        ],
        [paperTrail.transcript.id, { id: TRANSCRIPT.debate_id }, CTX],
        [paperTrail.receiptKey.id, {}, CTX],
        [inkprint.publicKey.id, {}, CTX],
        [inkthread.graph.id, { documentId: GOLDEN.documents[0]?.documentId }, CTX],
      ]),
    );
    expect(calls).toHaveLength(5);
    for (const [cap] of m.callCapability.mock.calls) expect(cap.cost).toBe("free");
  });

  it("with every issuer asleep, nothing that needs one passes", async () => {
    const answer = await verifyDossier(DOSSIER, CTX, STEPS);
    if (answer.legacy) throw new Error("not legacy");
    const checks = answer.checks;
    const live = checks.filter((c) =>
      ["certificates", "transcript", "envelope", "documents"].includes(c.name),
    );
    expect(live.map((c) => c.state)).toEqual([
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
    ]);
  });
});
