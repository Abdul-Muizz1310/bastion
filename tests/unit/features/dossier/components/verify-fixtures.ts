import type { VerifyAnswer } from "@/features/dossier/verify-answer";
import type { ToolOutcome } from "@/features/tools/outcome";
import { CERT_A, CERT_B, DEBATE_ID, DOC_ID, DOSSIER_ID } from "../fixtures";

/** Test-only "verify everything" answers, as the panel's seeded outcome. */

export const VERIFY_RID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

export function verifiedOk(): ToolOutcome<VerifyAnswer> {
  return {
    ok: true,
    status: 200,
    requestId: VERIFY_RID,
    data: {
      dossierId: DOSSIER_ID,
      legacy: false,
      checks: [
        {
          name: "certificates",
          state: "fail",
          detail: "1 of 2 certificates does not hold",
          items: [
            { ref: CERT_A, state: "pass", detail: "signature verified" },
            { ref: CERT_B, state: "fail", detail: "the excerpt differs from the certified text" },
          ],
        },
        {
          name: "transcript",
          state: "unavailable",
          detail: "paper-trail is asleep",
          items: [{ ref: DEBATE_ID, state: "unavailable", detail: "asleep" }],
        },
        { name: "envelope", state: "pass", detail: "the envelope signature verifies" },
        { name: "perf", state: "pass", detail: "the perf receipt recomputes" },
        { name: "audit", state: "pass", detail: "the audit digest recomputes over 37 events" },
        {
          name: "documents",
          state: "expired",
          detail: "the upload's graph is gone (kept for an hour)",
          items: [{ ref: DOC_ID, state: "expired", detail: "inkthread answered 410" }],
        },
        { name: "steps", state: "pass", detail: "the runner's 8 step rows are all present" },
      ],
    },
  };
}

export function verifiedLegacy(): ToolOutcome<VerifyAnswer> {
  return {
    ok: true,
    status: 200,
    requestId: VERIFY_RID,
    data: {
      dossierId: DOSSIER_ID,
      legacy: true,
      note: "this dossier predates verifiable receipts",
      checks: [],
    },
  };
}
