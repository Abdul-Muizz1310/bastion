import { describe, expect, it } from "vitest";
import { AUDIT_SERVICES, auditHref, hasFilters, parseAuditQuery } from "@/features/audit/filters";
import { likePrefix } from "@/platform/audit/like";

/**
 * Spec 21 §3.2 `/audit` and invariant 3: the filters are parsed at the boundary. Anything the page
 * does not understand is refused — named, with why — before anything is read.
 */

describe("parseAuditQuery: accepted", () => {
  it("no parameters: no filters, the newest page", () => {
    expect(parseAuditQuery({})).toEqual({ ok: true, query: { filters: {}, before: null } });
  });

  it("reads every filter and the cursor", () => {
    expect(
      parseAuditQuery({
        service: "magpie",
        action: "gateway.call",
        request: "4c6a0f3e-1b2d-4e5f-8a9b-0c1d2e3f4a5b",
        before: "1234",
      }),
    ).toEqual({
      ok: true,
      query: {
        filters: {
          service: "magpie",
          action: "gateway.call",
          request: "4c6a0f3e-1b2d-4e5f-8a9b-0c1d2e3f4a5b",
        },
        before: 1234,
      },
    });
  });

  it.each(AUDIT_SERVICES)("accepts the service %s", (service) => {
    expect(parseAuditQuery({ service })).toMatchObject({ ok: true, query: { filters: { service } } });
  });

  it("offers bastion and the six service ids, bastion first", () => {
    expect(AUDIT_SERVICES[0]).toBe("bastion");
    expect([...AUDIT_SERVICES].sort()).toEqual(
      ["bastion", "feathers-demo", "inkprint", "inkthread", "magpie", "paper-trail", "slowquery"].sort(),
    );
  });

  it("treats an empty value as no filter — what an empty form field submits", () => {
    expect(parseAuditQuery({ service: "", action: "", request: "", before: "" })).toEqual({
      ok: true,
      query: { filters: {}, before: null },
    });
  });

  it.each(["dossier.", "dossier.stage.ok", "gateway", "it-audit_x", "v1.security.csrf_failed", "0x"])(
    "accepts the action prefix %s",
    (action) => {
      expect(parseAuditQuery({ action })).toMatchObject({ ok: true, query: { filters: { action } } });
    },
  );

  it.each(["req-dossier-1", "a.b:c_d-e", "x".repeat(128)])("accepts the request id %s", (request) => {
    expect(parseAuditQuery({ request })).toMatchObject({ ok: true, query: { filters: { request } } });
  });
});

describe("parseAuditQuery: refused (invariant 3)", () => {
  it("refuses an unknown parameter, naming it", () => {
    expect(parseAuditQuery({ actor: "v_kk6eooepno" })).toEqual({
      ok: false,
      problems: [{ param: "actor", reason: "unknown" }],
    });
  });

  it("refuses a repeated parameter", () => {
    expect(parseAuditQuery({ service: ["magpie", "inkprint"] })).toEqual({
      ok: false,
      problems: [{ param: "service", reason: "repeated" }],
    });
  });

  it.each([
    ["service", "all"],
    ["service", "MAGPIE"],
    ["service", "feathers"],
    ["action", "%"],
    ["action", "_"],
    ["action", "Gateway.call"],
    ["action", ".call"],
    ["action", "gateway call"],
    ["action", "a".repeat(65)],
    ["request", "req/../../etc"],
    ["request", "x".repeat(129)],
    ["request", "req id"],
    ["before", "0"],
    ["before", "-5"],
    ["before", "12.5"],
    ["before", "1e3"],
    ["before", "0012"],
    ["before", "99999999999999999999"],
    ["before", "abc"],
  ])("refuses %s=%s as malformed", (param, value) => {
    expect(parseAuditQuery({ [param]: value })).toEqual({
      ok: false,
      problems: [{ param, reason: "malformed" }],
    });
  });

  it("names every problem at once, in parameter order", () => {
    expect(parseAuditQuery({ service: "nope", sort: "asc", before: ["1", "2"] })).toEqual({
      ok: false,
      problems: [
        { param: "service", reason: "malformed" },
        { param: "sort", reason: "unknown" },
        { param: "before", reason: "repeated" },
      ],
    });
  });

  it("refuses a parameter that is present but undefined as unknown only when its name is", () => {
    expect(parseAuditQuery({ service: undefined })).toEqual({
      ok: true,
      query: { filters: {}, before: null },
    });
  });

  it("does not echo a refused value", () => {
    const parsed = parseAuditQuery({ request: "<script>alert(1)</script>" });
    expect(JSON.stringify(parsed)).not.toContain("script");
  });
});

describe("auditHref", () => {
  it("is /audit with nothing set", () => {
    expect(auditHref({})).toBe("/audit");
  });

  it("keeps the filters and adds the cursor, in a fixed order", () => {
    expect(
      auditHref({ request: "req-1", action: "gateway.call", service: "magpie" }, 4321),
    ).toBe("/audit?service=magpie&action=gateway.call&request=req-1&before=4321");
  });

  it("encodes what it carries", () => {
    expect(auditHref({ request: "a:b" })).toBe("/audit?request=a%3Ab");
  });

  it("round-trips through the parser", () => {
    const filters = { service: "inkprint", action: "dossier.", request: "req.x:1" } as const;
    const href = auditHref(filters, 77);
    const params = Object.fromEntries(new URL(href, "https://bastion.test").searchParams);
    expect(parseAuditQuery(params)).toEqual({ ok: true, query: { filters, before: 77 } });
  });

  it("refuses a cursor that is not a positive whole number", () => {
    expect(() => auditHref({}, 0)).toThrow(RangeError);
    expect(() => auditHref({}, 1.5)).toThrow(RangeError);
  });
});

describe("hasFilters", () => {
  it("is false with no filter and true with any", () => {
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ action: "dossier." })).toBe(true);
  });
});

describe("likePrefix (invariant 3: the prefix matches itself)", () => {
  it("appends the wildcard", () => {
    expect(likePrefix("gateway.")).toBe("gateway.%");
  });

  it("escapes LIKE's own wildcards and its escape character", () => {
    expect(likePrefix("a_b")).toBe("a\\_b%");
    expect(likePrefix("50%")).toBe("50\\%%");
    expect(likePrefix("a\\b")).toBe("a\\\\b%");
  });

  it("refuses an empty prefix: it would match everything", () => {
    expect(() => likePrefix("")).toThrow(RangeError);
  });
});
