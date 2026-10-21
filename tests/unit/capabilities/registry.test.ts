import { describe, expect, it } from "vitest";
import { CAPABILITIES, CAPABILITY_LIST, capabilityById, indexById } from "@/capabilities";
import { DEFAULT_TIMEOUT_MS } from "@/platform/gateway/call";
import { RAW_CONTENT_TYPES } from "@/platform/gateway/result";
import { isServiceId, SERVICES } from "@/platform/registry/products";

/**
 * The capability table is data (spec 21 §4): id, service, method, grant, cost class, budget. This
 * pins it to the plan's table (Task 4) so a grant or a budget can never drift silently.
 */

type Row = [id: string, method: string, grant: string, cost: string, budget?: string, raw?: string];

const TABLE: Row[] = [
  ["magpie.sources", "GET", "viewer", "free"],
  ["magpie.items", "GET", "viewer", "free"],
  ["magpie.heals", "GET", "viewer", "free"],
  ["magpie.scrape", "POST", "editor", "quota", "scrape"],
  ["magpie.scrapeBatch", "POST", "editor", "quota", "scrape"],
  ["inkprint.certify", "POST", "editor", "quota", "certify"],
  ["inkprint.certifyBatch", "POST", "editor", "quota", "certify"],
  ["inkprint.certificate", "GET", "viewer", "free"],
  ["inkprint.verify", "POST", "viewer", "free"],
  ["inkprint.verifyBatch", "POST", "viewer", "free"],
  // Ruling M: every diff buys an embedding, counted against the certify budget.
  ["inkprint.diff", "POST", "editor", "quota", "certify"],
  ["inkprint.leakScan", "POST", "editor", "quota", "leakscan"],
  ["inkprint.leakScanStatus", "GET", "viewer", "free"],
  ["inkprint.envelope", "POST", "editor", "free"],
  ["inkprint.publicKey", "GET", "viewer", "free", undefined, "pem"],
  ["inkprint.qr", "GET", "viewer", "free", undefined, "png"],
  ["paper-trail.debate", "POST", "editor", "llm", "debate"],
  ["paper-trail.debateGet", "GET", "viewer", "free"],
  ["paper-trail.transcript", "GET", "viewer", "free"],
  ["paper-trail.receiptKey", "GET", "viewer", "free"],
  ["paper-trail.list", "GET", "viewer", "free"],
  ["inkthread.samples", "GET", "viewer", "free"],
  ["inkthread.document", "GET", "viewer", "free"],
  ["inkthread.graph", "GET", "viewer", "free"],
  ["inkthread.reading", "GET", "viewer", "free"],
  ["inkthread.why", "GET", "viewer", "free"],
  ["inkthread.job", "GET", "viewer", "free"],
  ["inkthread.page", "GET", "viewer", "free", undefined, "png"],
  ["inkthread.upload", "POST", "editor", "llm", "upload"],
  ["slowquery.queries", "GET", "viewer", "free"],
  ["slowquery.query", "GET", "viewer", "free"],
  ["slowquery.branch", "GET", "viewer", "free"],
  ["slowquery.switch", "POST", "editor", "free"],
  ["feathers.users", "GET", "viewer", "free"],
  ["feathers.user", "GET", "viewer", "free"],
  // feathers_demo's feathers.yaml declares `POST /users ... auth: admin`: an editor token is 403.
  ["feathers.createUser", "POST", "admin", "quota", "feathers.write"],
  ["feathers.deleteUser", "DELETE", "admin", "quota", "feathers.write"],
];

const SERVICE_OF: Record<string, string> = {
  magpie: "magpie",
  inkprint: "inkprint",
  "paper-trail": "paper-trail",
  inkthread: "inkthread",
  slowquery: "slowquery",
  feathers: "feathers-demo",
};

describe("CAPABILITIES", () => {
  it("holds exactly the plan's capabilities", () => {
    expect(Object.keys(CAPABILITIES).sort()).toStrictEqual(TABLE.map((r) => r[0]).sort());
  });

  it("has unique ids, each keyed by its own id", () => {
    const ids = CAPABILITY_LIST.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [key, cap] of Object.entries(CAPABILITIES)) expect(cap.id).toBe(key);
  });

  it.each(TABLE)("%s: %s, grant %s, cost %s, budget %s", (id, method, grant, cost, budget, raw) => {
    const cap = CAPABILITIES[id];
    expect(cap).toBeDefined();
    expect({
      method: cap?.method,
      grant: cap?.grant,
      cost: cap?.cost,
      budget: cap?.budget,
      raw: cap?.raw,
    }).toStrictEqual({ method, grant, cost, budget, raw });
  });

  it("names a service in SERVICES for every capability, the one its product runs", () => {
    for (const cap of CAPABILITY_LIST) {
      expect(isServiceId(cap.service)).toBe(true);
      expect(Object.hasOwn(SERVICES, cap.service)).toBe(true);
      const product = cap.id.split(".")[0] ?? "";
      expect(cap.service).toBe(SERVICE_OF[product]);
    }
  });

  it("budgets every llm capability and every quota capability with a budget key", () => {
    for (const cap of CAPABILITY_LIST) {
      if (cap.cost === "llm") expect(cap.budget).toBeDefined();
    }
  });

  it("declares a known raw kind with a byte schema for every raw capability", () => {
    for (const cap of CAPABILITY_LIST.filter((c) => c.raw !== undefined)) {
      expect(Object.hasOwn(RAW_CONTENT_TYPES, cap.raw ?? "")).toBe(true);
    }
  });

  it("times every call out within the tools route's 100 s", () => {
    for (const cap of CAPABILITY_LIST) {
      expect(cap.timeoutMs ?? DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(95_000);
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(CAPABILITY_LIST)).toBe(true);
  });

  it("refuses a repeated id instead of letting the second silently win", () => {
    const [first] = CAPABILITY_LIST;
    if (!first) throw new Error("no capabilities");
    expect(() => indexById([first, { ...first }])).toThrow(/duplicate capability id/);
  });
});

describe("capabilityById", () => {
  it("finds a capability by id", () => {
    expect(capabilityById("magpie.sources")?.id).toBe("magpie.sources");
  });

  it.each([["constructor"], ["__proto__"], ["toString"], ["hasOwnProperty"], ["magpie"], [""]])(
    "finds nothing for %j",
    (id) => {
      expect(capabilityById(id)).toBeUndefined();
    },
  );
});
