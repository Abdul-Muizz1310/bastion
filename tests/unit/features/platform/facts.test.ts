import { describe, expect, it } from "vitest";
import { commitFact, serviceFacts, versionText } from "@/features/platform/facts";
import type { StatusSnapshot } from "@/features/health/model";

/**
 * Spec 21 §3.2 `/platform`: a service's live facts from the shared status. A version or SHA comes
 * from the service's own `/version` body — untrusted — so it is checked before it is linked.
 */

const REPO = "https://github.com/Abdul-Muizz1310/magpie-backend";
const SHA = "3f9c2a1b7e4d5c6f8a9b0c1d2e3f4a5b6c7d8e9f";

describe("commitFact", () => {
  it("links a full SHA to its commit, shown short", () => {
    expect(commitFact(SHA, REPO)).toEqual({
      kind: "link",
      short: "3f9c2a1",
      full: SHA,
      href: `${REPO}/commit/${SHA}`,
    });
  });

  it("links a 7-digit SHA, lower-cased", () => {
    expect(commitFact("ABCDEF0", REPO)).toMatchObject({ kind: "link", short: "abcdef0" });
  });

  it.each([
    ["too short", "abc123"],
    ["too long", "a".repeat(41)],
    ["not hex", "release-2026-10"],
    ["a path", "../../etc/passwd"],
    ["markup", "<b>deadbeef</b>"],
  ])("shows a SHA that is %s as text, never as a link", (_what, sha) => {
    const fact = commitFact(sha, REPO);
    expect(fact.kind).toBe("text");
  });

  it("cuts a long non-SHA to 40 characters", () => {
    const fact = commitFact("x".repeat(100), REPO);
    expect(fact).toEqual({ kind: "text", text: "x".repeat(40) });
  });

  it("reads 'not reported' when there is none", () => {
    expect(commitFact(undefined, REPO)).toEqual({ kind: "none" });
    expect(commitFact("   ", REPO)).toEqual({ kind: "none" });
  });

  it("refuses a repo URL that is not a GitHub repo of this account", () => {
    expect(() => commitFact(SHA, "https://evil.example/x")).toThrow(RangeError);
  });
});

describe("versionText", () => {
  it("keeps a short version as it is", () => {
    expect(versionText("0.2.1")).toBe("0.2.1");
  });

  it("cuts a long one to 32 characters", () => {
    expect(versionText("v".repeat(50))).toBe("v".repeat(32));
  });

  it("is null when there is none", () => {
    expect(versionText(undefined)).toBeNull();
    expect(versionText(" ")).toBeNull();
  });
});

describe("serviceFacts", () => {
  const ok: StatusSnapshot = {
    phase: "ok",
    checkedAt: "2026-10-21T10:00:00.000Z",
    services: {
      magpie: {
        service: "magpie",
        state: "live",
        latencyMs: 181.4,
        version: "1.4.0",
        commitSha: SHA,
        checkedAt: "2026-10-21T10:00:00.000Z",
      },
      inkprint: {
        service: "inkprint",
        state: "asleep",
        latencyMs: 8000,
        checkedAt: "2026-10-21T10:00:00.000Z",
      },
    },
  };

  it("a live service: its state, latency, version and linked commit", () => {
    expect(serviceFacts("magpie", ok, REPO)).toEqual({
      state: "live",
      detail: "181 ms",
      version: "1.4.0",
      commit: { kind: "link", short: "3f9c2a1", full: SHA, href: `${REPO}/commit/${SHA}` },
    });
  });

  it("an asleep service reports no version, and says so", () => {
    expect(serviceFacts("inkprint", ok, REPO)).toEqual({
      state: "asleep",
      version: null,
      commit: { kind: "none" },
    });
  });

  it("before the first answer every service is checking", () => {
    expect(serviceFacts("magpie", { phase: "checking" }, REPO).state).toBe("checking");
  });

  it("a failed poll makes every service unknown, never a guess (§3.2 invariant 7)", () => {
    const facts = serviceFacts("magpie", { phase: "error", checkedAt: "x" }, REPO);
    expect(facts).toEqual({ state: "unknown", version: null, commit: { kind: "none" } });
  });

  it("a service the answer left out is unknown", () => {
    expect(serviceFacts("slowquery", ok, REPO).state).toBe("unknown");
  });
});
