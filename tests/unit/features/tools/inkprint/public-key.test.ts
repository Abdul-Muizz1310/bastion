import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readPublicKey } from "@/features/tools/inkprint/public-key";

/**
 * inkprint's public key, read raw through the tools route (review fix 7): a PEM is the answer;
 * anything else is named like every other failure, so a limit reads as a limit.
 */

const PEM = readFileSync(resolve(__dirname, "../../../../fixtures/downstream/inkprint/public-key.pem"), "utf8");
const RID = "rid-key";

describe("readPublicKey", () => {
  it("reads the PEM and its request id", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(PEM, { headers: { "content-type": "text/plain", "x-request-id": RID } }),
    );
    expect(await readPublicKey({ fetchImpl })).toEqual({ ok: true, data: PEM, status: 200, requestId: RID });
    expect(fetchImpl).toHaveBeenCalledWith("/api/tools/inkprint.publicKey", expect.anything());
  });

  it.each([
    [504, { error: "asleep", requestId: RID }, "asleep"],
    [429, { error: "rate_limited", retryAfterS: 12, requestId: RID }, "rate_limited"],
    [502, { error: "invalid_response", requestId: RID }, "invalid_response"],
  ])("names a %i as %s", async (status, body, kind) => {
    const fetchImpl = vi.fn(async () => Response.json(body, { status }));
    expect(await readPublicKey({ fetchImpl })).toMatchObject({ ok: false, kind, requestId: RID });
  });

  it("refuses a 200 that is not a PEM public key", async () => {
    const fetchImpl = vi.fn(async () => new Response("hello", { headers: { "x-request-id": RID } }));
    expect(await readPublicKey({ fetchImpl })).toMatchObject({ ok: false, kind: "invalid_response" });
  });

  it("calls a network failure bastion unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await readPublicKey({ fetchImpl })).toMatchObject({ ok: false, kind: "unreachable" });
  });
});
