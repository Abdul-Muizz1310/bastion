import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/dossiers/[id]/receipts` (spec 21 §6.3, §6.5): the receipts bundle, public, downloaded
 * as `dossier-<id>.receipts.json` — the canonical JSON of the dossier's public fields, evidence,
 * documents and receipts, so a stranger can re-check everything without bastion. 404 for a dossier
 * that does not exist.
 */

const m = vi.hoisted(() => ({
  findDossier: vi.fn(),
  listEvidence: vi.fn(),
  listDocuments: vi.fn(),
  listReceipts: vi.fn(),
}));

vi.mock("@/dossier/store", () => ({ findDossier: m.findDossier }));
vi.mock("@/dossier/evidence", () => ({ listEvidence: m.listEvidence }));
vi.mock("@/dossier/documents", () => ({ listDocuments: m.listDocuments }));
vi.mock("@/dossier/receipts", () => ({ listReceipts: m.listReceipts }));

import * as route from "@/app/api/dossiers/[id]/receipts/route";
import { receiptsBundle } from "@/dossier/bundle";
import { canonicalJson } from "@/platform/canonical-json";
import { dossier } from "../../../../../dossier/stages/helpers";
import { allReceipts, documents, DOSSIER } from "../../../../../dossier/verify-golden";

const ID = DOSSIER.id;
const row = dossier({ id: ID, requestId: DOSSIER.requestId, status: "succeeded" });

function get(id = ID): Promise<Response> {
  return route.GET(new Request(`https://bastion.test/api/dossiers/${id}/receipts`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  m.findDossier.mockReset().mockResolvedValue(row);
  m.listEvidence.mockReset().mockResolvedValue([]);
  m.listDocuments.mockReset().mockResolvedValue(documents());
  m.listReceipts.mockReset().mockResolvedValue(allReceipts());
});

describe("GET /api/dossiers/[id]/receipts", () => {
  it("is dynamic", () => {
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("downloads the bundle as dossier-<id>.receipts.json", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="dossier-${ID}.receipts.json"`,
    );
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is the canonical JSON of the dossier's public fields, evidence, documents and receipts", async () => {
    const body = await (await get()).text();
    expect(body).toBe(
      canonicalJson(
        receiptsBundle({
          dossier: row,
          evidence: [],
          documents: documents(),
          receipts: allReceipts(),
        }),
      ),
    );
    expect(m.listReceipts).toHaveBeenCalledWith(ID);
    expect(m.listEvidence).toHaveBeenCalledWith(ID);
    expect(m.listDocuments).toHaveBeenCalledWith(ID);
    expect(body).not.toContain(row.visitor ?? "never");
  });

  it("answers 404 for an unknown dossier, in the gateway's error shape", async () => {
    m.findDossier.mockResolvedValue(null);
    const res = await get("not-a-dossier");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: "unknown_dossier",
      requestId: expect.any(String),
    });
    expect(m.listReceipts).not.toHaveBeenCalled();
  });

  it("answers 500 in the gateway's error shape when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.listReceipts.mockRejectedValue(new Error("db down"));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "receipts_failed" });
  });
});
