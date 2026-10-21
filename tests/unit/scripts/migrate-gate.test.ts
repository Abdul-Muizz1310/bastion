import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Plan Task 1, ruling D — `scripts/migrate.mjs` is the first half of `pnpm build`. It migrates
 * only inside a Vercel build (VERCEL_ENV set) or when forced; everywhere else it says so in one
 * line and exits 0 without connecting. When it does run, a failure must fail the build.
 *
 * Hermetic: no case here reaches a database (the one "unreachable" case uses a refused port).
 */

const ROOT = resolve(__dirname, "../../..");
const SCRIPT = resolve(ROOT, "scripts/migrate.mjs");
const UNREACHABLE = "postgresql://nobody:nothing@127.0.0.1:1/none";

type Run = { code: number; stdout: string; stderr: string };

function run(args: string[], env: Record<string, string | undefined>): Promise<Run> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.VERCEL_ENV;
  delete childEnv.DATABASE_URL;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  return new Promise((done) => {
    execFile(
      process.execPath,
      [SCRIPT, ...args],
      { env: childEnv, cwd: ROOT },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        done({ code, stdout, stderr });
      },
    );
  });
}

describe("migrate.mjs — the build gate", () => {
  it("outside Vercel it logs one line and exits 0 without connecting", async () => {
    const result = await run([], { DATABASE_URL: UNREACHABLE });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(result.stdout).toMatch(/skip/i);
    expect(result.stdout).toMatch(/VERCEL_ENV/);
  });

  it("treats an empty VERCEL_ENV as unset", async () => {
    const result = await run([], { VERCEL_ENV: "", DATABASE_URL: UNREACHABLE });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/skip/i);
  });

  it("skips even without DATABASE_URL — a local or CI build needs no database", async () => {
    const result = await run([], {});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/skip/i);
  });

  it("inside a Vercel build, a missing DATABASE_URL fails the build", async () => {
    const result = await run([], { VERCEL_ENV: "production" });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/DATABASE_URL/);
  });

  it("--force without DATABASE_URL fails", async () => {
    const result = await run(["--force"], {});
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/DATABASE_URL/);
  });

  it("an unreachable database fails the build instead of deploying against an old schema", async () => {
    const result = await run([], { VERCEL_ENV: "production", DATABASE_URL: UNREACHABLE });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/migrate/i);
  });

  it("never prints the connection string, even on failure", async () => {
    const result = await run(["--force"], { DATABASE_URL: UNREACHABLE });
    expect(result.code).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain("nothing");
  });

  it("rejects an unknown argument rather than guessing", async () => {
    const result = await run(["--forse"], { DATABASE_URL: UNREACHABLE });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/--forse/);
  });
});
