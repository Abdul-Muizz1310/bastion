import { type DisplayState, nodeHealth, type StatusSnapshot } from "@/features/health/model";
import type { ServiceId } from "@/platform/registry/products";

/**
 * A service's live facts on `/platform` (spec 21 §3.2): its state from the shared 30 s status, its
 * version and its commit. Both come from the service's own `/version` body — untrusted text — so a
 * SHA links to its commit only when it is 7–40 hex digits, and both are cut short. Pure, and safe
 * in the browser.
 */

export type CommitFact =
  | { kind: "link"; short: string; full: string; href: string }
  | { kind: "text"; text: string }
  | { kind: "none" };

export type ServiceFacts = {
  state: DisplayState;
  detail?: string;
  version: string | null;
  commit: CommitFact;
};

const SHA = /^[0-9a-f]{7,40}$/i;
const REPO_URL = /^https:\/\/github\.com\/Abdul-Muizz1310\/[a-z0-9-]+$/;
const MAX_VERSION = 32;
const MAX_COMMIT_TEXT = 40;

export function commitFact(sha: string | undefined, repoUrl: string): CommitFact {
  if (!REPO_URL.test(repoUrl)) {
    throw new RangeError("commitFact: the repo must be one of this account's GitHub repos");
  }
  const value = sha?.trim() ?? "";
  if (value === "") return { kind: "none" };
  if (!SHA.test(value)) return { kind: "text", text: value.slice(0, MAX_COMMIT_TEXT) };
  const full = value.toLowerCase();
  return { kind: "link", short: full.slice(0, 7), full, href: `${repoUrl}/commit/${full}` };
}

export function versionText(version: string | undefined): string | null {
  const value = version?.trim() ?? "";
  return value === "" ? null : value.slice(0, MAX_VERSION);
}

export function serviceFacts(
  id: ServiceId,
  snapshot: StatusSnapshot,
  repoUrl: string,
): ServiceFacts {
  const { state, detail } = nodeHealth([id], snapshot);
  const answer = snapshot.phase === "ok" ? snapshot.services[id] : undefined;
  return {
    state,
    ...(detail === undefined ? {} : { detail }),
    version: versionText(answer?.version),
    commit: commitFact(answer?.commitSha, repoUrl),
  };
}
