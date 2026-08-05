import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Toolchain invariants that only surface as an inscrutable build failure.
 *
 * `next build` verifies its TypeScript setup by resolving the literal path
 * `typescript/lib/typescript.js` (node_modules/next/dist/lib/verify-typescript-setup.js).
 * TypeScript 7 is the Go rewrite and ships no such file — its `lib/` holds only
 * `getExePath.js`, `tsc.js` and `version.cjs`, and its package `exports` map has
 * no `.` entry pointing at a JS API. So a `typescript: ^7` bump does not fail
 * with a version complaint; it fails with
 *
 *     It looks like you're trying to use TypeScript but do not have the
 *     required package(s) installed.
 *
 * which reads as a missing dependency and sends you looking in the wrong place.
 * Next reaches the native compiler through `@typescript/native-preview`, not
 * through the `typescript` package major. Assert the range here so the real
 * constraint is stated once, in the open, and fails by name.
 */

const repoRoot = resolve(__dirname, "../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

type PackageJson = {
  devDependencies: Record<string, string>;
  dependencies: Record<string, string>;
};

const pkg = JSON.parse(read("package.json")) as PackageJson;

/** Leading major from an npm range like `^5`, `~5.9.3`, `5.x`, `>=5 <6`. */
function majorOf(range: string): number {
  const match = /(\d+)/.exec(range);
  if (!match) throw new Error(`cannot read a major version from ${range}`);
  return Number(match[1]);
}

describe("toolchain compatibility", () => {
  it("keeps typescript on a major whose lib/typescript.js next build can resolve", () => {
    const range = pkg.devDependencies.typescript;
    expect(range, "typescript must stay a declared devDependency").toBeTruthy();
    expect(
      majorOf(range),
      `typescript ${range} is not consumable by next ${pkg.dependencies.next}: ` +
        "next build resolves typescript/lib/typescript.js, which TypeScript 7+ " +
        "(the Go rewrite) does not ship. Use @typescript/native-preview for the " +
        "native compiler instead of bumping the typescript major.",
    ).toBeLessThan(7);
  });

  it("keeps @types/node aligned with the node version CI actually runs", () => {
    const workflow = read(".github/workflows/ci.yml");
    const pinned = [...workflow.matchAll(/node-version:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(pinned.length, "ci.yml must pin node-version").toBeGreaterThan(0);
    expect(new Set(pinned).size, `ci.yml pins conflicting node versions: ${pinned}`).toBe(1);

    // Types that run ahead of the runtime describe APIs that are not there at
    // execution time, and the compiler reports nothing.
    expect(
      majorOf(pkg.devDependencies["@types/node"]),
      `@types/node ${pkg.devDependencies["@types/node"]} must not run ahead of ` +
        `the Node ${pinned[0]} that ci.yml installs`,
    ).toBeLessThanOrEqual(pinned[0]);
  });
});
