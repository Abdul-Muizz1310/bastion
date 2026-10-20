import { parseStatusResponse, type StatusSnapshot } from "./model";
import type { Visibility } from "./poll";

/** The browser edge of the health poll: one uncached GET, parsed — never cast (spec 21 §3.1 case 4). */

export const STATUS_PATH = "/api/platform/status";

export async function fetchPlatformStatus(
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<StatusSnapshot> {
  const res = await fetchImpl(STATUS_PATH, {
    cache: "no-store",
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`status: GET ${STATUS_PATH} answered ${res.status}`);
  return parseStatusResponse(await res.json());
}

export function documentVisibility(doc: Document = document): Visibility {
  return {
    isHidden: () => doc.visibilityState === "hidden",
    onVisible(listener) {
      const handle = () => {
        if (doc.visibilityState === "visible") listener();
      };
      doc.addEventListener("visibilitychange", handle);
      return () => doc.removeEventListener("visibilitychange", handle);
    },
  };
}
