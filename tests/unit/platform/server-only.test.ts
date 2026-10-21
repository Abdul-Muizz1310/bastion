import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ruling AH: modules that hold secrets, budgets or the gateway say so with `import "server-only"`,
 * so a client bundle that reaches one fails the build instead of shipping it. The browser-side code
 * (capability schemas, workbench components) may import their types, never their values.
 */

const ROOT = resolve(__dirname, "../../..");
const SERVER_ONLY = [
  "src/features/audit/load.ts",
  "src/features/audit/read-limit.ts",
  "src/features/audit/server/query.ts",
  "src/features/dossier/load.ts",
  "src/features/platform/load.ts",
  "src/features/time-travel/to-view.ts",
  "src/features/tools/components/WorkbenchPage.tsx",
  "src/features/tools/feathers/proof.ts",
  "src/features/tools/load.ts",
  "src/features/tools/paper-trail/transcript-check.ts",
  "src/platform/audit/read.ts",
  "src/platform/budget.ts",
  "src/platform/gateway/call.ts",
  "src/platform/gateway/http.ts",
  "src/platform/gateway/keys.ts",
  "src/platform/gateway/result.ts",
  "src/platform/gateway/token.ts",
];

/** What the browser loads: the capability schemas, every workbench and the dossier pages' islands. */
const CLIENT_DIRS = [
  "src/capabilities",
  "src/components/tools",
  "src/features/audit",
  "src/features/dossier",
  "src/features/platform",
  "src/features/time-travel",
  "src/features/tools",
];

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? files(path) : [path];
  });
}

const alias = (file: string) => `@/${file.replace(/^src\//, "").replace(/\.tsx?$/, "")}`;

describe("server-only modules (Ruling AH)", () => {
  it.each(SERVER_ONLY)("%s declares itself server-only", (file) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    expect(text).toMatch(/^import "server-only";$/m);
  });

  it("no browser-side module imports a value from one", () => {
    const serverPaths = new Set(SERVER_ONLY.map(alias));
    const offenders: string[] = [];
    for (const file of CLIENT_DIRS.flatMap(files)) {
      const text = readFileSync(join(ROOT, file), "utf8");
      // A module that declares itself server-only is server code: it may import server values.
      if (/^import "server-only";$/m.test(text)) continue;
      for (const m of text.matchAll(/^import\s+(type\s+)?([^;]*?)\s+from\s+"([^"]+)";/gm)) {
        const [, typeOnly, names = "", from = ""] = m;
        if (!serverPaths.has(from) || typeOnly) continue;
        const specifiers = names.replace(/[{}]/g, "").split(",").map((n) => n.trim()).filter(Boolean);
        if (specifiers.some((n) => !n.startsWith("type "))) offenders.push(`${relative(ROOT, join(ROOT, file))} ← ${from}`);
      }
    }
    // Routes and server pages live in src/app and are not scanned: they are not browser code.
    expect(offenders).toEqual([]);
  });
});
