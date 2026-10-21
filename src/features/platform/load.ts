import "server-only";
import type { Budgets } from "@/features/tools/budgets";
import { budgetsLeft as readBudgets } from "@/platform/budget";
import { keyId as readKeyId } from "@/platform/gateway/keys";
import { ConfigError } from "@/platform/secrets";

/**
 * What `/platform` reads on the server (spec 21 §3.2): today's budgets, the key id tokens are
 * signed under, and the commit bastion was deployed from. Each failure is said on the page — a
 * budget store that does not answer is `null`, a malformed `BASTION_KEY_ID` is "unreadable" (its
 * value is never carried) — and never fails the page. Secrets are never read here.
 */

export type KidFact = { kind: "ok"; kid: string } | { kind: "unreadable" };

export type PlatformData = {
  budgets: Budgets | null;
  kid: KidFact;
  /** `VERCEL_GIT_COMMIT_SHA` when deployed; null otherwise. */
  bastionCommit: string | null;
};

export type PlatformDeps = {
  budgetsLeft: () => Promise<Budgets>;
  keyId: () => string;
  commitSha: () => string | undefined;
};

const DEFAULT_DEPS: PlatformDeps = {
  budgetsLeft: readBudgets,
  keyId: readKeyId,
  commitSha: () => process.env.VERCEL_GIT_COMMIT_SHA,
};

function readKid(keyId: () => string): KidFact {
  try {
    return { kind: "ok", kid: keyId() };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`platform: ${err.message}`);
    return { kind: "unreadable" };
  }
}

export async function loadPlatform(deps: PlatformDeps = DEFAULT_DEPS): Promise<PlatformData> {
  const kid = readKid(deps.keyId);
  const budgets = await deps.budgetsLeft().catch((err: unknown) => {
    console.error("platform: today's budgets are unavailable", err);
    return null;
  });
  const sha = deps.commitSha()?.trim() ?? "";
  return { budgets, kid, bastionCommit: sha === "" ? null : sha };
}
