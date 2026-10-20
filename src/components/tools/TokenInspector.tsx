import type { ReactNode } from "react";
import type { TokenPreview } from "@/features/tools/bastion/token-preview";

/**
 * bastion's token inspector (spec 21 §5, §7): the decoded header and claims of the platform token
 * bastion mints for one capability call, each claim with what it means to the backend that checks
 * it. Never the token: what is shown cannot be replayed.
 */

function utc(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

type Row = { name: string; value: string; meaning: ReactNode };

function claimRows(p: TokenPreview): Row[] {
  const c = p.claims;
  return [
    {
      name: "iss",
      value: c.iss,
      meaning: "who minted it — bastion; a frontend’s own key says otherwise",
    },
    {
      name: "aud",
      value: c.aud,
      meaning: p.capability.routed
        ? `only ${c.aud} may accept it — for this capability it follows the host each call goes to`
        : `the audience: only ${c.aud} may accept it`,
    },
    { name: "service", value: c.service, meaning: "the receiving service, always equal to aud" },
    {
      name: "sub",
      value: c.sub,
      meaning:
        "your pseudonym today: a keyed hash of your address and the UTC date, never reversible",
    },
    {
      name: "role",
      value: c.role,
      meaning: "the grant this capability needs; the backend gates on it",
    },
    {
      name: "cap",
      value: c.cap,
      meaning: "which capability asked — informational, never trusted to authorise",
    },
    { name: "iat", value: utc(c.iat), meaning: "issued at" },
    {
      name: "exp",
      value: utc(c.exp),
      meaning: `expires ${c.exp - c.iat} s after it was issued; backends allow 10 s of clock leeway`,
    },
    { name: "jti", value: c.jti, meaning: "a fresh id per token, so a replay can be spotted" },
  ];
}

function Rows({ rows }: { rows: readonly Row[] }) {
  return (
    <dl className="divide-y divide-border">
      {rows.map((row) => (
        <div
          key={row.name}
          className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[4.5rem_minmax(0,1fr)]"
        >
          <dt className="font-mono text-xs text-accent-violet">{row.name}</dt>
          <dd className="min-w-0 font-mono text-xs">
            <span translate="no" className="break-all text-foreground">
              {row.value}
            </span>
            <span className="mt-0.5 block text-fg-muted">{row.meaning}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function TokenInspector({ preview }: { preview: TokenPreview }) {
  const header: Row[] = [
    { name: "alg", value: preview.header.alg, meaning: "an Ed25519 signature" },
    { name: "kid", value: preview.header.kid, meaning: "which key in the JWKS verifies it" },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <section aria-labelledby="token-header" className="space-y-2">
        <h3
          id="token-header"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted"
        >
          header
        </h3>
        <Rows rows={header} />
        <p className="pt-2 font-mono text-[11px] leading-relaxed text-fg-muted">
          Decoded claims — never the token. bastion shows what it would sign, not a signature anyone
          could reuse. The public key that verifies the real one is in the{" "}
          <a
            href={preview.jwks}
            className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            JWKS
          </a>
          .
        </p>
      </section>
      <section aria-labelledby="token-claims" className="space-y-2">
        <h3
          id="token-claims"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted"
        >
          claims · {preview.capability.id}
        </h3>
        <Rows rows={claimRows(preview)} />
      </section>
    </div>
  );
}
