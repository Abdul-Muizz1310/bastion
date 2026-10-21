// Daily liveness check for every muizz-lab host (run by .github/workflows/liveness.yml).
//
// Render's free services sleep and take up to ~70 s to wake, so a backend gets 120 s before it
// counts as down. A billing-suspended Render service answers 503 while every Vercel frontend keeps
// answering 200, which is how the whole fleet once went dark for four weeks unnoticed.
// Prints a JSON summary; exits 1 when anything failed.

const BACKEND_TIMEOUT_MS = 120_000;
const OTHER_TIMEOUT_MS = 30_000;

export const TARGETS = [
  { name: "paper-trail-backend", kind: "backend", url: "https://paper-trail-backend-jjpf.onrender.com/health" },
  { name: "magpie-backend", kind: "backend", url: "https://magpie-backend-t4bb.onrender.com/health" },
  { name: "inkprint-backend", kind: "backend", url: "https://inkprint-backend.onrender.com/health" },
  { name: "inkthread-backend", kind: "backend", url: "https://inkthread-backend.onrender.com/health" },
  { name: "slowquery-demo-backend", kind: "backend", url: "https://slowquery-demo-backend.onrender.com/health" },
  { name: "feathers-demo", kind: "backend", url: "https://feathers-demo-rznj.onrender.com/health" },
  { name: "bastion", kind: "frontend", url: "https://bastion-six.vercel.app/api/health" },
  { name: "paper-trail-frontend", kind: "frontend", url: "https://paper-trail-frontend-sable.vercel.app/" },
  { name: "magpie-frontend", kind: "frontend", url: "https://magpie-frontend-three.vercel.app/" },
  { name: "inkprint-frontend", kind: "frontend", url: "https://inkprint-frontend.vercel.app/" },
  { name: "slowquery-dashboard-frontend", kind: "frontend", url: "https://slowquery-dashboard-frontend.vercel.app/" },
  { name: "inkthread-frontend", kind: "frontend", url: "https://inkthread-frontend.vercel.app/" },
  { name: "feathers-cli", kind: "package", url: "https://pypi.org/pypi/feathers-cli/json" },
  { name: "slowquery-detective", kind: "package", url: "https://pypi.org/pypi/slowquery-detective/json" },
  { name: "inkgrid", kind: "package", url: "https://pypi.org/pypi/inkgrid/json" },
];

/** Pure: a probe outcome to a verdict. Frontends may redirect; backends and packages may not. */
export function classify(target, outcome) {
  if (outcome.error === "timeout") {
    return { ok: false, reason: `timeout after ${Math.round(outcome.ms / 1000)} s` };
  }
  if (outcome.error) return { ok: false, reason: outcome.error };
  const { status } = outcome;
  if (status >= 200 && status < 300) return { ok: true };
  if (target.kind === "frontend" && status >= 300 && status < 400) return { ok: true };
  return { ok: false, reason: `HTTP ${status}` };
}

/** Pure: the issue text for a failed run. */
export function issueBody(results, at) {
  const lines = results
    .filter((r) => !r.ok)
    .map((r) => `- **${r.name}** — ${r.reason} (${r.url})`);
  return [`Liveness check at ${at} found ${lines.length} failing host(s):`, "", ...lines].join("\n");
}

async function probe(target) {
  const timeoutMs = target.kind === "backend" ? BACKEND_TIMEOUT_MS : OTHER_TIMEOUT_MS;
  const started = Date.now();
  try {
    const response = await fetch(target.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "muizz-lab-liveness" },
    });
    return { status: response.status, ms: Date.now() - started };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const code = err instanceof Error ? (err.cause?.code ?? err.message) : String(err);
    return { error: timedOut ? "timeout" : code, ms: Date.now() - started };
  }
}

async function main() {
  const results = await Promise.all(
    TARGETS.map(async (target) => {
      const outcome = await probe(target);
      return { name: target.name, url: target.url, ms: outcome.ms, ...classify(target, outcome) };
    }),
  );
  const at = new Date().toISOString();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ at, failed: failed.length, results }, null, 2));
  if (failed.length > 0) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync("liveness-issue.md", issueBody(results, at));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
