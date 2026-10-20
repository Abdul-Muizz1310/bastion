import { describe, expect, it, vi } from "vitest";

/**
 * `saveSealed`'s guards (spec 21 §6.3), which run before any statement: nothing to save is a no-op,
 * and two records with one candidate key are refused (the row would keep one certificate, the
 * receipt could name the other). Its SQL is proven in tests/integration/db/evidence.test.ts.
 */

vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    throw new Error("the guards must not reach the database");
  },
}));

import { type SealedRecord, saveSealed } from "@/dossier/evidence";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const record = (key: string, certificateId: string): SealedRecord => ({
  candidate: {
    key,
    kind: "web",
    product: "magpie",
    title: "t",
    url: "https://example.org",
    text: "x",
    locator: { kind: "url", url: "https://example.org" },
  },
  certificateId,
  contentHash: "m",
  inkprintHash: "c".repeat(64),
  signature: null,
  text: "x",
});

describe("saveSealed guards", () => {
  it("saves nothing for no records", async () => {
    expect(await saveSealed(ID, [])).toBe(0);
  });

  it("refuses two records with one key before touching the database", async () => {
    await expect(
      saveSealed(ID, [
        record("w-a", "00000000-0000-4000-8000-000000000001"),
        record("w-a", "00000000-0000-4000-8000-000000000002"),
      ]),
    ).rejects.toThrow(RangeError);
  });
});
