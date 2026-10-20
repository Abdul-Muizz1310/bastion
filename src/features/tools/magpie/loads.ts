import { type MagpieHeal, type MagpieItem, magpie, type ScrapeResult } from "@/capabilities/magpie";
import { callTool } from "../client";
import type { Action } from "../use-action";

/**
 * magpie's reads (spec 21 §5.1, review rounds 3–4): its sources, then the chosen source's items and
 * heal history. Each list loads on its own, so a retry reloads the list that failed and nothing
 * else; only the visitor choosing a source clears the last scrape (it was of another source).
 */

/** How many of a source's newest items the workbench shows. */
export const ITEMS = 20;
const HEALS = 10;

export type MagpieList = "sources" | "items" | "heals";

/** One first load to run: the sources, or one list of the chosen source. Never the scrape. */
export type MagpieLoad = { list: "sources" } | { list: "items" | "heals"; source: string };

/**
 * The first loads due when the gate opens. `due` spends a list's single automatic retry
 * (`useFirstLoad`), so it is asked only about what could run: the lists wait for the sources and
 * for a chosen source.
 */
export function loadsDue(due: (list: MagpieList) => boolean, source: string | null): MagpieLoad[] {
  if (due("sources")) return [{ list: "sources" }];
  if (source === null) return [];
  const loads: MagpieLoad[] = [];
  for (const list of ["items", "heals"] as const) {
    if (due(list)) loads.push({ list, source });
  }
  return loads;
}

export type SourceReads = {
  /** Reads the source's newest items alone. */
  items: (source: string) => void;
  /** Reads the source's heal history alone. */
  heals: (source: string) => void;
  /** The visitor picked a source: the last scrape goes, both lists are read. */
  choose: (source: string) => void;
};

export function sourceReads(a: {
  items: Pick<Action<MagpieItem[]>, "run">;
  heals: Pick<Action<MagpieHeal[]>, "run">;
  scrape: Pick<Action<ScrapeResult>, "set">;
}): SourceReads {
  const items = (name: string) =>
    void a.items.run((signal) => callTool(magpie.items, { name, limit: ITEMS }, { signal }));
  const heals = (name: string) =>
    void a.heals.run((signal) =>
      callTool(magpie.heals, { source: name, limit: HEALS }, { signal }),
    );
  return {
    items,
    heals,
    choose: (name) => {
      a.scrape.set(null);
      items(name);
      heals(name);
    },
  };
}

/** Runs the due first loads: a list's retry goes to that list's read, never to `choose`. */
export function runDue(
  due: (list: MagpieList) => boolean,
  source: string | null,
  run: { sources: () => void; reads: Pick<SourceReads, "items" | "heals"> },
): void {
  for (const load of loadsDue(due, source)) {
    if (load.list === "sources") run.sources();
    else run.reads[load.list](load.source);
  }
}
