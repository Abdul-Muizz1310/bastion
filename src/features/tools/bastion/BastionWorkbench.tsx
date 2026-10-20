"use client";

import { useEffect, useId, useState } from "react";
import * as z from "zod/mini";
import { CAPABILITY_LIST, capabilityById } from "@/capabilities";
import { Outcome } from "@/components/tools/Outcome";
import { Panel } from "@/components/tools/Panel";
import { BUTTON, BUTTON_QUIET, INPUT, LABEL } from "@/components/tools/styles";
import { TokenInspector } from "@/components/tools/TokenInspector";
import { ToolReceipt } from "@/components/tools/ToolReceipt";
import { useWakeReady } from "@/components/tools/WakeGate";
import { callTool, getRoute } from "../client";
import type { ToolOutcome } from "../outcome";
import { useAction } from "../use-action";
import { type TokenPreview, tokenPreviewSchema } from "./token-preview";

/**
 * bastion's own workbench (spec 21 §5, §5.1). The token inspector shows the decoded header and
 * claims bastion mints for a capability call as this visitor — never the token — beside the JWKS
 * that verifies the real one. A free call through the gateway shows the receipt bastion keeps for
 * every call: its audit event.
 */

export type BastionState = {
  capability?: string;
  preview?: ToolOutcome<TokenPreview>;
  call?: ToolOutcome<unknown>;
  called?: string;
};

const P = "bastion";

/** Every capability, grouped by the service it belongs to, for the inspector's picker. */
const BY_SERVICE = CAPABILITY_LIST.reduce<Map<string, string[]>>((groups, cap) => {
  const product = cap.service === "feathers-demo" ? "feathers" : cap.service;
  groups.set(product, [...(groups.get(product) ?? []), cap.id]);
  return groups;
}, new Map());

/** Free reads that take no input: what a visitor can call here at no cost. */
const FREE_CALLS = CAPABILITY_LIST.filter(
  (c) =>
    c.method === "GET" && c.cost === "free" && c.raw === undefined && c.input.safeParse({}).success,
).map((c) => c.id);

const jwksSchema = z.object({
  keys: z.array(
    z.object({ kty: z.string(), crv: z.string(), x: z.string(), kid: z.string(), alg: z.string() }),
  ),
});

export function BastionWorkbench({ initial = {} }: { initial?: BastionState }) {
  const ready = useWakeReady();
  const ids = useId();
  const [capability, setCapability] = useState(initial.capability ?? "inkprint.certify");
  const [called, setCalled] = useState(initial.called ?? FREE_CALLS[0] ?? "");
  const preview = useAction(initial.preview ?? null);
  const jwks = useAction<z.infer<typeof jwksSchema>>(null);
  const call = useAction(initial.call ?? null);

  const inspect = (id: string) => {
    setCapability(id);
    void preview.run((signal) =>
      getRoute(
        `/api/platform/token-preview?capability=${encodeURIComponent(id)}`,
        tokenPreviewSchema,
        {
          signal,
        },
      ),
    );
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on load
  useEffect(() => {
    if (preview.outcome === null) inspect(capability);
    void jwks.run((signal) => getRoute("/.well-known/jwks.json", jwksSchema, { signal }));
  }, []);

  const makeCall = () => {
    const cap = capabilityById(called);
    if (cap === undefined) return;
    // The inspector follows the call: these are the claims bastion mints for it.
    inspect(called);
    void call.run((signal) => callTool(cap, {}, { signal }));
  };

  const kid = preview.outcome?.ok ? preview.outcome.data.header.kid : null;

  return (
    <div className="space-y-8">
      <Panel
        id="bastion-token"
        title="token inspector"
        hint="the claims of a platform token — never the token"
      >
        <div className="max-w-md space-y-1.5">
          <label htmlFor={`${ids}-cap`} className={LABEL}>
            capability
          </label>
          <select
            id={`${ids}-cap`}
            value={capability}
            onChange={(e) => inspect(e.target.value)}
            className={INPUT}
          >
            {[...BY_SERVICE].map(([product, capabilities]) => (
              <optgroup key={product} label={product}>
                {capabilities.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <Outcome state={preview} product={P} what="the decoded claims">
          {(p) => <TokenInspector preview={p} />}
        </Outcome>
      </Panel>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          id="bastion-call"
          title="a call and its audit event"
          hint="every gateway call is logged, append-only"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <label htmlFor={`${ids}-call`} className={LABEL}>
                a free read
              </label>
              <select
                id={`${ids}-call`}
                value={called}
                onChange={(e) => setCalled(e.target.value)}
                className={INPUT}
              >
                {FREE_CALLS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={makeCall}
              disabled={!ready || call.busy}
              className={BUTTON}
            >
              make the call
            </button>
          </div>
          <p className="font-mono text-[11px] leading-relaxed text-fg-muted">
            bastion mints a token like the one above, calls the service, and appends one audit
            event: the capability, the service, the status and the time it took — never the body.
          </p>
          <Outcome state={call} product={called.split(".")[0] ?? P} what="the call">
            {(_data, requestId) => (
              <ToolReceipt
                kind="bastion gateway call"
                serial={requestId.slice(0, 8)}
                title={called}
                stamp={{ text: "audited", tone: "pass" }}
                lines={[
                  { label: "capability", value: called },
                  { label: "service", value: capabilityById(called)?.service ?? "?" },
                  { label: "status", value: call.outcome?.ok ? String(call.outcome.status) : "?" },
                  { label: "request", value: requestId },
                ]}
                requestId={requestId}
              />
            )}
          </Outcome>
        </Panel>

        <Panel
          id="bastion-jwks"
          title="JWKS"
          hint="the public key every backend verifies bastion’s tokens with"
        >
          <a
            href="/.well-known/jwks.json"
            className="font-mono text-xs text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            /.well-known/jwks.json
          </a>
          <Outcome state={jwks} product={P} what="the JWKS">
            {(set) => (
              <ul className="space-y-3 font-mono text-xs">
                {set.keys.map((k) => (
                  <li key={k.kid} className="space-y-0.5">
                    <p>
                      <span className="text-fg-muted">kid</span>{" "}
                      <span translate="no" className="text-foreground">
                        {k.kid}
                      </span>
                      {kid === null ? null : kid === k.kid ? (
                        <span className="text-success">
                          {" "}
                          ✓ the inspector’s token names this key
                        </span>
                      ) : (
                        <span className="text-warning"> another key than the inspector’s</span>
                      )}
                    </p>
                    <p className="text-fg-muted">
                      {k.kty} · {k.crv} · {k.alg}
                    </p>
                    <p translate="no" className="break-all text-foreground/80">
                      x {k.x}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Outcome>
          <button
            type="button"
            onClick={() =>
              void jwks.run((signal) => getRoute("/.well-known/jwks.json", jwksSchema, { signal }))
            }
            disabled={jwks.busy}
            className={BUTTON_QUIET}
          >
            read it again
          </button>
        </Panel>
      </div>
    </div>
  );
}
