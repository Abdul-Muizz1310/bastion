"use client";

import { useEffect, useState } from "react";
import {
  type BranchSwitch,
  type QueryDetail,
  type QueryRow,
  SLOWQUERY_HOSTS,
  type SlowqueryHost,
  slowquery,
} from "@/capabilities/slowquery";
import { ServiceBadge } from "@/components/platform/ServiceBadge";
import { CopyButton } from "@/components/tools/CopyButton";
import { Outcome } from "@/components/tools/Outcome";
import { Panel, WithReceipt } from "@/components/tools/Panel";
import { BUTTON, BUTTON_QUIET, MONO_BLOCK } from "@/components/tools/styles";
import { ToolReceipt } from "@/components/tools/ToolReceipt";
import { useWakeReady } from "@/components/tools/WakeGate";
import { callTool } from "../client";
import { ms, plural, utc } from "../format";
import type { FailedOutcome, ToolOutcome } from "../outcome";
import { useAction } from "../use-action";
import { fleetView, type HostAnswer, rankMs } from "./fleet";

/**
 * slowquery's workbench (spec 21 §5, §5.1): the fleet — `/_slowquery/queries` on the four product
 * backends and the demo, read in parallel and ranked — a fingerprint's EXPLAIN plan and exact
 * `CREATE INDEX`, and the demo's slow/fast branch switch.
 */

export type SlowqueryState = {
  fleet?: HostAnswer[];
  chosen?: { service: SlowqueryHost; id: string };
  detail?: ToolOutcome<QueryDetail>;
  branch?: ToolOutcome<{ active: "slow" | "fast" }>;
  switched?: ToolOutcome<BranchSwitch>;
};

const P = "slowquery";

function hostFailure(f: FailedOutcome): { state: "asleep" | "down" | "unknown"; detail?: string } {
  switch (f.kind) {
    case "asleep":
      return { state: "asleep" };
    case "rate_limited":
      return { state: "unknown", detail: `rate limited · retry in ${f.retryAfterS} s` };
    case "downstream_error":
      return f.status === 404
        ? { state: "unknown", detail: "no /_slowquery here yet" }
        : { state: "down", detail: `answered ${f.status}` };
    default:
      return { state: "unknown", detail: f.kind.replaceAll("_", " ") };
  }
}

export function SlowqueryWorkbench({ initial = {} }: { initial?: SlowqueryState }) {
  const ready = useWakeReady();
  const [fleet, setFleet] = useState<HostAnswer[] | null>(initial.fleet ?? null);
  const [reading, setReading] = useState(false);
  const [chosen, setChosen] = useState(initial.chosen ?? null);
  const detail = useAction(initial.detail ?? null);
  const branch = useAction(initial.branch ?? null);
  const switched = useAction(initial.switched ?? null);

  const readFleet = async () => {
    setReading(true);
    const answers = await Promise.all(
      SLOWQUERY_HOSTS.map(async (service) => ({
        service,
        outcome: await callTool(slowquery.queries, { service }, {}).catch(
          (): ToolOutcome<QueryRow[]> => ({ ok: false, kind: "unreachable", requestId: null }),
        ),
      })),
    );
    setFleet(answers);
    setReading(false);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the gate opens
  useEffect(() => {
    if (!ready) return;
    if (fleet === null) void readFleet();
    if (branch.outcome === null)
      void branch.run((signal) => callTool(slowquery.branch, {}, { signal }));
  }, [ready]);

  const choose = (service: SlowqueryHost, id: string) => {
    setChosen({ service, id });
    void detail.run((signal) => callTool(slowquery.query, { service, id }, { signal }));
  };

  const view = fleet === null ? null : fleetView(fleet);
  const active = switched.outcome?.ok
    ? switched.outcome.data.active
    : branch.outcome?.ok
      ? branch.outcome.data.active
      : null;

  return (
    <div className="space-y-8">
      <Panel
        id="sq-fleet"
        title="the fleet’s slowest queries"
        hint="five hosts, read in parallel, ranked by p95"
      >
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => void readFleet()}
            disabled={!ready || reading}
            className={BUTTON}
          >
            {reading ? "reading…" : "read the fleet"}
          </button>
          <p aria-live="polite" className="sr-only">
            {reading ? "reading the fleet…" : view ? `${view.rows.length} fingerprints ranked` : ""}
          </p>
        </div>
        {view ? (
          <>
            <ul className="flex flex-wrap gap-x-6 gap-y-1.5 font-mono text-xs">
              {view.hosts.map((h) =>
                h.state === "ok" ? (
                  <li key={h.service} className="text-fg-muted">
                    <span translate="no" className="text-foreground">
                      {h.service}
                    </span>{" "}
                    · {plural(h.count, "fingerprint")}
                  </li>
                ) : (
                  <li key={h.service}>
                    <ServiceBadge service={h.service} {...hostFailure(h.failure)} />
                  </li>
                ),
              )}
            </ul>
            {view.rows.length === 0 ? (
              <p className="font-mono text-xs text-fg-muted">No host has recorded a query yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-mono text-xs">
                  <caption className="sr-only">
                    the slowest query fingerprints across the fleet
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.14em] text-fg-muted">
                      <th scope="col" className="py-2 pr-3 font-normal">
                        #
                      </th>
                      <th scope="col" className="py-2 pr-3 font-normal">
                        host
                      </th>
                      <th scope="col" className="py-2 pr-3 font-normal">
                        fingerprint
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right font-normal">
                        calls
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right font-normal">
                        p95 <span className="normal-case">(or max)</span>
                      </th>
                      <th scope="col" className="py-2 font-normal">
                        <span className="sr-only">open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map(({ service, row }, i) => {
                      const isChosen = chosen?.service === service && chosen.id === row.id;
                      return (
                        <tr
                          key={`${service}:${row.id}`}
                          className={`border-b border-border/70 align-top ${isChosen ? "bg-accent-violet-soft" : ""}`}
                        >
                          <td className="py-2 pr-3 text-fg-muted tabular-nums">{i + 1}</td>
                          <td className="py-2 pr-3 text-foreground" translate="no">
                            {service}
                          </td>
                          <td
                            className="max-w-[32rem] py-2 pr-3 text-foreground/90 [overflow-wrap:anywhere]"
                            translate="no"
                          >
                            {row.fingerprint}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{row.call_count}</td>
                          <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                            {ms(rankMs(row))}
                          </td>
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              onClick={() => choose(service, row.id)}
                              disabled={!ready}
                              aria-pressed={isChosen}
                              className={BUTTON_QUIET}
                            >
                              plan<span className="sr-only"> for fingerprint {i + 1}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </Panel>

      <Panel
        id="sq-plan"
        title="the plan and the index"
        hint="EXPLAIN, and the exact CREATE INDEX to run"
      >
        {chosen === null ? (
          <p className="font-mono text-xs text-fg-muted">Choose a fingerprint’s plan above.</p>
        ) : null}
        <Outcome state={detail} product={P} what="the plan">
          {(d, requestId) => (
            <PlanView detail={d} service={chosen?.service ?? "slowquery"} requestId={requestId} />
          )}
        </Outcome>
      </Panel>

      <Panel
        id="sq-branch"
        title="the demo’s branch"
        hint="the demo runs on a slow branch and an indexed fast one"
      >
        <p className="font-mono text-xs text-fg-muted">
          now on{" "}
          <span className="font-display text-sm font-bold text-accent-violet">{active ?? "…"}</span>
        </p>
        <div className="flex flex-wrap gap-3">
          {(["slow", "fast"] as const).map((target) => (
            <button
              key={target}
              type="button"
              onClick={() =>
                void switched.run((signal) => callTool(slowquery.switch, { target }, { signal }))
              }
              disabled={!ready || switched.busy || active === target}
              className={BUTTON_QUIET}
            >
              switch to {target}
            </button>
          ))}
        </div>
        <p className="font-mono text-[11px] text-fg-muted">
          Twice a minute per visitor: a switch rebuilds the demo for everyone.
        </p>
        <Outcome state={switched} product={P} what="the switch">
          {(s, requestId) => (
            <ToolReceipt
              kind="slowquery switch"
              serial={s.active}
              title={`the demo now runs on ${s.active}`}
              lines={[
                { label: "active", value: s.active },
                { label: "switched", value: utc(s.switched_at) },
                { label: "took", value: ms(s.latency_ms) },
              ]}
              requestId={requestId}
            />
          )}
        </Outcome>
      </Panel>
    </div>
  );
}

function PlanView({
  detail: d,
  service,
  requestId,
}: {
  detail: QueryDetail;
  service: string;
  requestId: string;
}) {
  const plan = d.explain_plan;
  const indexes = d.suggestions.filter((s) => s.sql !== null);
  return (
    <WithReceipt
      receipt={
        <ToolReceipt
          kind="slowquery plan"
          serial={d.fingerprint.id}
          title={`${service} · ${plural(d.fingerprint.call_count, "call")}`}
          lines={[
            {
              label: "plan cost",
              value: plan?.cost === null || plan === null ? "none" : String(plan.cost),
            },
            { label: "captured", value: plan ? utc(plan.captured_at) : "no plan yet" },
            { label: "suggestions", value: String(d.suggestions.length) },
            { label: "index", value: indexes[0]?.sql ?? "none" },
          ]}
          extra={[`fingerprint: ${d.canonical_sql}`, ...indexes.map((s) => s.sql ?? "")]}
          requestId={requestId}
        />
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
            the query
          </p>
          <pre className={MONO_BLOCK}>{d.canonical_sql}</pre>
        </div>
        <div className="space-y-1.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">EXPLAIN</p>
          {plan === null ? (
            <p className="font-mono text-xs text-fg-muted">No plan captured yet.</p>
          ) : (
            <pre className={MONO_BLOCK}>
              {plan.plan_text ?? JSON.stringify(plan.plan_json, null, 2)}
            </pre>
          )}
        </div>
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
            what to do
          </p>
          {d.suggestions.length === 0 ? (
            <p className="font-mono text-xs text-fg-muted">
              No suggestion: the plan is already good.
            </p>
          ) : (
            <ul className="space-y-3">
              {d.suggestions.map((s) => (
                <li
                  key={`${s.kind}:${s.sql ?? s.rationale}`}
                  className="space-y-1.5 font-mono text-xs"
                >
                  <p className="text-fg-muted">
                    <span className="text-accent-violet">{s.kind}</span> · from {s.source} ·{" "}
                    {s.rationale}
                  </p>
                  {s.sql ? (
                    <div className="flex items-start gap-2">
                      <pre className={`${MONO_BLOCK} flex-1 text-success`}>{s.sql}</pre>
                      <CopyButton text={s.sql} label="the SQL" />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </WithReceipt>
  );
}
