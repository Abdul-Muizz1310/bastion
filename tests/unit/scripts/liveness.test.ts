import { describe, expect, it } from "vitest";
import { classify, issueBody, TARGETS } from "../../../scripts/liveness.mjs";

const NEVER_USE = [
  "bastion.vercel.app",
  "paper-trail-backend.onrender.com",
  "paper-trail-frontend.vercel.app",
  "magpie-backend.onrender.com",
  "magpie-frontend.vercel.app",
];

describe("classify", () => {
  it("passes a backend whose /health answers 200", () => {
    expect(classify({ kind: "backend" }, { status: 200, ms: 900 })).toEqual({ ok: true });
  });

  it("passes a frontend that redirects", () => {
    expect(classify({ kind: "frontend" }, { status: 307, ms: 120 })).toEqual({ ok: true });
  });

  it("fails a 503, which is how a billing-suspended Render service answers", () => {
    expect(classify({ kind: "backend" }, { status: 503, ms: 300 })).toEqual({
      ok: false,
      reason: "HTTP 503",
    });
  });

  it("fails a redirect from a backend health route", () => {
    expect(classify({ kind: "backend" }, { status: 302, ms: 300 }).ok).toBe(false);
  });

  it("fails a timeout and a network error with their own reasons", () => {
    expect(classify({ kind: "backend" }, { error: "timeout", ms: 120_000 })).toEqual({
      ok: false,
      reason: "timeout after 120 s",
    });
    expect(classify({ kind: "package" }, { error: "ENOTFOUND", ms: 40 })).toEqual({
      ok: false,
      reason: "ENOTFOUND",
    });
  });
});

describe("TARGETS", () => {
  it("covers the six backends, six frontends and three packages", () => {
    const count = (kind: string) => TARGETS.filter((t: { kind: string }) => t.kind === kind).length;
    expect(count("backend")).toBe(6);
    expect(count("frontend")).toBe(6);
    expect(count("package")).toBe(3);
  });

  it("never names a host on the never-use list", () => {
    for (const target of TARGETS) {
      const host = new URL(target.url).host;
      expect(NEVER_USE).not.toContain(host);
    }
  });
});

describe("issueBody", () => {
  it("lists only the failures, with each reason", () => {
    const body = issueBody(
      [
        { name: "inkprint-backend", url: "https://inkprint-backend.onrender.com/health", ok: false, reason: "HTTP 503" },
        { name: "inkgrid", url: "https://pypi.org/pypi/inkgrid/json", ok: true },
      ],
      "2026-10-20T06:00:00Z",
    );
    expect(body).toContain("inkprint-backend");
    expect(body).toContain("HTTP 503");
    expect(body).not.toContain("inkgrid");
    expect(body).toContain("2026-10-20T06:00:00Z");
  });
});
