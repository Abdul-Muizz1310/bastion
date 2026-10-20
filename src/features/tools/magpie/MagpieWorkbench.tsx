"use client";

import { useEffect, useState } from "react";
import {
  type MagpieHeal,
  type MagpieItem,
  type MagpieSource,
  magpie,
  type ScrapeResult,
} from "@/capabilities/magpie";
import { BudgetedAction } from "@/components/tools/BudgetedAction";
import { Outcome } from "@/components/tools/Outcome";
import { Panel, WithReceipt } from "@/components/tools/Panel";
import { ToolReceipt } from "@/components/tools/ToolReceipt";
import { useWakeReady } from "@/components/tools/WakeGate";
import { useBudgets } from "../BudgetProvider";
import { callTool } from "../client";
import { plural, short, utc } from "../format";
import type { ToolOutcome } from "../outcome";
import { useAction } from "../use-action";

/**
 * magpie's workbench (spec 21 §5, §5.1): pick a source, browse its items (each with its content
 * hash), scrape it once (budget `scrape`), and read its heal history with each self-heal PR.
 */

export type MagpieState = {
  sources?: ToolOutcome<MagpieSource[]>;
  source?: string;
  items?: ToolOutcome<MagpieItem[]>;
  scrape?: ToolOutcome<ScrapeResult>;
  heals?: ToolOutcome<MagpieHeal[]>;
};

const ITEMS = 20;
const P = "magpie";

export function MagpieWorkbench({ initial = {} }: { initial?: MagpieState }) {
  const ready = useWakeReady();
  const { refresh } = useBudgets();
  const sources = useAction(initial.sources ?? null);
  const items = useAction(initial.items ?? null);
  const heals = useAction(initial.heals ?? null);
  const scrape = useAction(initial.scrape ?? null);
  const [source, setSource] = useState<string | null>(initial.source ?? null);

  const choose = (name: string) => {
    setSource(name);
    scrape.set(null);
    void items.run((signal) => callTool(magpie.items, { name, limit: ITEMS }, { signal }));
    void heals.run((signal) => callTool(magpie.heals, { source: name, limit: 10 }, { signal }));
  };

  // Once magpie is awake: its sources, then the first one that has items.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the gate opens
  useEffect(() => {
    if (!ready || sources.outcome !== null) return;
    void sources
      .run((signal) => callTool(magpie.sources, {}, { signal }))
      .then((outcome) => {
        if (!outcome?.ok || source !== null) return;
        const first = outcome.data.find((s) => s.item_count > 0) ?? outcome.data[0];
        if (first) choose(first.name);
      });
  }, [ready]);

  const runScrape = () => {
    if (source === null) return;
    void scrape
      .run((signal) => callTool(magpie.scrape, { source, max_items: 10 }, { signal }))
      .then(() => refresh());
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <Panel id="magpie-sources" title="sources" hint="YAML scrapers, one per site">
          <Outcome state={sources} product={P} what="the sources">
            {(list) => (
              <fieldset className="space-y-2">
                <legend className="sr-only">pick a source</legend>
                {list.map((s) => (
                  <label
                    key={s.name}
                    className="flex cursor-pointer gap-3 rounded-[3px] border border-border px-3 py-2.5 transition-colors hover:border-fg-muted has-[:checked]:border-accent-violet has-[:checked]:bg-accent-violet-soft"
                  >
                    <input
                      type="radio"
                      name="magpie-source"
                      value={s.name}
                      checked={source === s.name}
                      onChange={() => choose(s.name)}
                      disabled={!ready}
                      className="mt-1 accent-[var(--accent-violet)]"
                    />
                    <span className="min-w-0 font-mono text-xs">
                      <span translate="no" className="block text-foreground">
                        {s.name}
                      </span>
                      <span className="block text-fg-muted">{s.description}</span>
                      <span className="mt-1 block text-fg-muted tabular-nums">
                        {plural(s.item_count, "item")} · last run{" "}
                        {s.last_run_at ? utc(s.last_run_at) : "never"}
                        {s.last_status ? ` · ${s.last_status}` : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </Outcome>
          {sources.outcome === null && !sources.busy ? (
            <p className="font-mono text-xs text-fg-muted">
              The sources load once magpie is awake.
            </p>
          ) : null}
        </Panel>

        <Panel
          id="magpie-scrape"
          title="scrape once"
          hint="a live fetch: each item comes back with its content hash"
        >
          <BudgetedAction
            budget="scrape"
            label={source ? `scrape ${source} once` : "scrape once"}
            busyLabel="scraping…"
            busy={scrape.busy}
            disabled={source === null}
            onRun={runScrape}
          />
          {scrape.outcome === null && !scrape.busy ? (
            <p className="font-mono text-xs leading-relaxed text-fg-muted">
              One press fetches the source now, as magpie’s scheduler would. If a selector has
              broken, magpie heals it and the fix shows up in the heal history below.
            </p>
          ) : null}
          <Outcome state={scrape} product={P} what="the scrape">
            {(run, requestId) => (
              <WithReceipt
                receipt={
                  <ToolReceipt
                    kind="magpie scrape"
                    serial={run.run_id.slice(0, 8)}
                    title={`${run.source} · ${plural(run.items.length, "item")}`}
                    lines={[
                      { label: "scraped", value: utc(run.scraped_at) },
                      { label: "run", value: run.run_id },
                      { label: "items", value: String(run.items.length) },
                      { label: "first hash", value: run.items[0]?.content_hash ?? "none" },
                    ]}
                    extra={run.items.map((i) => `${i.content_hash}  ${i.url}`)}
                    requestId={requestId}
                  />
                }
              >
                <ItemTable
                  caption={`what this scrape fetched from ${run.source}`}
                  rows={run.items.map((i) => ({
                    key: i.stable_id,
                    title: i.title,
                    url: i.url,
                    hash: i.content_hash,
                    seen: i.fetched_at,
                  }))}
                />
              </WithReceipt>
            )}
          </Outcome>
        </Panel>
      </div>

      <Panel
        id="magpie-items"
        title="items"
        hint={source ? `the newest ${ITEMS} from ${source}` : undefined}
      >
        <Outcome state={items} product={P} what="the items">
          {(list, requestId) => (
            <WithReceipt
              receipt={
                <ToolReceipt
                  kind="magpie items"
                  serial={source ?? undefined}
                  title={`${plural(list.length, "item")} from ${source ?? "magpie"}`}
                  lines={[
                    { label: "items", value: String(list.length) },
                    { label: "newest seen", value: list[0] ? utc(list[0].last_seen_at) : "none" },
                    { label: "first hash", value: list[0]?.content_hash ?? "none" },
                  ]}
                  extra={list.map((i) => `${i.content_hash}  ${i.url}`)}
                  requestId={requestId}
                />
              }
            >
              <ItemTable
                caption={`items magpie holds for ${source ?? "this source"}`}
                rows={list.map((i) => ({
                  key: i.id,
                  title: i.title,
                  url: i.url,
                  hash: i.content_hash,
                  seen: i.last_seen_at,
                }))}
              />
            </WithReceipt>
          )}
        </Outcome>
      </Panel>

      <Panel
        id="magpie-heals"
        title="heal history"
        hint="when a selector broke, the fix magpie proposed"
      >
        <Outcome state={heals} product={P} what="the heal history">
          {(list, requestId) => (
            <WithReceipt
              receipt={
                <ToolReceipt
                  kind="magpie heals"
                  serial={source ?? undefined}
                  title={`${plural(list.length, "self-heal")} for ${source ?? "magpie"}`}
                  lines={[
                    { label: "heals", value: String(list.length) },
                    { label: "with a PR", value: String(list.filter((h) => h.pr_url).length) },
                    { label: "latest PR", value: list.find((h) => h.pr_url)?.pr_url ?? "none" },
                  ]}
                  extra={list.map((h) => `${h.created_at}  ${h.pr_url ?? "no PR"}`)}
                  requestId={requestId}
                />
              }
            >
              {list.length === 0 ? (
                <p className="font-mono text-xs text-fg-muted">
                  No heals yet: every selector of this source still matches.
                </p>
              ) : (
                <ol className="space-y-3">
                  {list.map((h) => (
                    <li
                      key={h.id}
                      className="rounded-[3px] border border-border px-3 py-2.5 font-mono text-xs"
                    >
                      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <span className="text-fg-muted tabular-nums">{utc(h.created_at)}</span>
                        {h.pr_url ? (
                          <a
                            href={h.pr_url}
                            className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
                          >
                            {prLabel(h.pr_url)}
                            <span aria-hidden="true"> ↗</span>
                          </a>
                        ) : (
                          <span className="text-fg-muted">no PR opened</span>
                        )}
                      </p>
                      <p className="mt-1.5 text-fg-muted">
                        changed: {changedKeys(h).join(", ") || "nothing it can name"}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </WithReceipt>
          )}
        </Outcome>
      </Panel>
    </div>
  );
}

type Row = { key: string; title: string; url: string; hash: string; seen: string };

function ItemTable({ caption, rows }: { caption: string; rows: readonly Row[] }) {
  if (rows.length === 0) {
    return <p className="font-mono text-xs text-fg-muted">No items.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-mono text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.14em] text-fg-muted">
            <th scope="col" className="py-2 pr-4 font-normal">
              item
            </th>
            <th scope="col" className="py-2 pr-4 font-normal">
              content hash
            </th>
            <th scope="col" className="py-2 font-normal">
              seen
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/70 align-top">
              <td className="max-w-[28rem] py-2 pr-4">
                {r.url ? (
                  <a
                    href={r.url}
                    className="text-foreground underline decoration-border-bright underline-offset-4 hover:text-accent-violet"
                  >
                    {r.title || r.url}
                  </a>
                ) : (
                  <span className="text-fg-muted">{r.title || "(no title)"}</span>
                )}
              </td>
              <td className="py-2 pr-4 text-fg-muted tabular-nums" title={r.hash} translate="no">
                {short(r.hash, 16)}
              </td>
              <td className="whitespace-nowrap py-2 text-fg-muted tabular-nums">{utc(r.seen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function prLabel(url: string): string {
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return match ? `${match[1]} #${match[2]}` : url;
}

/** The config keys a heal changed. */
function changedKeys(h: MagpieHeal): string[] {
  const keys = new Set([...Object.keys(h.old_config), ...Object.keys(h.new_config)]);
  return [...keys].filter(
    (k) => JSON.stringify(h.old_config[k]) !== JSON.stringify(h.new_config[k]),
  );
}
