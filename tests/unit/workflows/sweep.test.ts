import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Spec 21 §6.2 "The sweep": `.github/workflows/sweep.yml` calls the sweep every 30 minutes (and by
 * hand) — a safety net for abandoned runs that keeps the database's compute low — with `curl`, the
 * token from the repository's secrets, a time limit under the route's 300 s, and fails on any
 * non-2xx answer. Checked as text: the workflow must say exactly this.
 */

const yml = readFileSync(join(process.cwd(), ".github", "workflows", "sweep.yml"), "utf8");
const lines = yml.split("\n");

describe("the sweep workflow", () => {
  it("runs every 30 minutes and by hand (Ruling AM)", () => {
    expect(yml).toMatch(
      /^on:\n {2}schedule:\n {4}- cron: "\*\/30 \* \* \* \*"\n {2}workflow_dispatch:/m,
    );
  });

  it("POSTs the production sweep route with the secret as a bearer token, failing on non-2xx", () => {
    const curl = lines.filter((l) => l.includes("curl") && !l.trim().startsWith("#"));
    expect(curl).toHaveLength(1);
    const line = curl[0] ?? "";
    expect(line).toContain("curl -fsS");
    expect(line).toContain("-X POST");
    expect(line).toContain('-H "Authorization: Bearer $BASTION_SWEEP_TOKEN"');
    expect(line).toContain("https://bastion-six.vercel.app/api/dossiers/sweep");
    expect(yml).toContain("BASTION_SWEEP_TOKEN: ${{ secrets.BASTION_SWEEP_TOKEN }}");
  });

  it("gives up before the route's 300 s, and the job soon after", () => {
    const maxTime = Number(/--max-time (\d+)/.exec(yml)?.[1]);
    expect(maxTime).toBe(295);
    expect(Number(/timeout-minutes: (\d+)/.exec(yml)?.[1])).toBeLessThanOrEqual(6);
  });

  it("never prints the token, runs one sweep at a time, and asks for no repository permissions", () => {
    expect(yml).not.toMatch(/echo[^\n]*\$BASTION_SWEEP_TOKEN/);
    expect(yml).not.toContain("set -x");
    expect(yml).toMatch(/^concurrency:\n {2}group: sweep\n/m);
    expect(yml).toMatch(/^permissions: \{\}$/m);
  });

  it("names no host but the live bastion (never the bare bastion.vercel.app)", () => {
    const hosts = [...yml.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]);
    expect(hosts).toEqual(["bastion-six.vercel.app"]);
  });
});
