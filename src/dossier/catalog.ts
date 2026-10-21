import { inkthread } from "@/capabilities/inkthread";
import { magpie } from "@/capabilities/magpie";
import { SYSTEM_ACTOR } from "@/platform/audit/event";
import { callCapability } from "@/platform/gateway/call";

/**
 * The lists a new dossier is validated against (spec 21 §3): magpie's source slugs and inkthread's
 * curated sample ids. Both are public reads, made as the system actor so a visitor's own rate limit
 * never pays for them, and cached for 5 minutes in-process. A failed load is `null` and is not
 * cached: the caller answers 503 rather than guessing.
 */

export const CATALOG_TTL_MS = 300_000;

export type Catalog = {
  /** The entries, or `null` when the list could not be loaded. */
  get(): Promise<ReadonlySet<string> | null>;
};

export type CatalogOptions = { ttlMs?: number; now?: () => number };

export function createCatalog(
  load: () => Promise<readonly string[] | null>,
  options: CatalogOptions = {},
): Catalog {
  const ttlMs = options.ttlMs ?? CATALOG_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: { entries: ReadonlySet<string>; until: number } | null = null;
  let inflight: Promise<ReadonlySet<string> | null> | null = null;

  async function fill(): Promise<ReadonlySet<string> | null> {
    const entries = await load();
    if (entries === null) return null;
    const set = new Set(entries);
    cached = { entries: set, until: now() + ttlMs };
    return set;
  }

  return {
    async get() {
      if (cached !== null && now() < cached.until) return cached.entries;
      inflight ??= fill().finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}

let sequence = 0;
const requestId = (kind: string) => `catalog-${kind}-${process.pid}-${++sequence}`;

export const knownSources = createCatalog(async () => {
  const r = await callCapability(
    magpie.sources,
    {},
    { actor: SYSTEM_ACTOR, requestId: requestId("sources") },
  );
  return r.ok ? r.data.map((s) => s.name) : null;
});

export const knownSamples = createCatalog(async () => {
  const r = await callCapability(
    inkthread.samples,
    {},
    { actor: SYSTEM_ACTOR, requestId: requestId("samples") },
  );
  return r.ok ? r.data.items.map((d) => d.id) : null;
});
