import type { ReactNode } from "react";
import { AuditLink } from "@/components/tools/AuditLink";
import type { AuditView, EnvelopeView, Section } from "../receipt-view";

/**
 * The two receipts that close a dossier (spec 21 §6.1, §6.6): inkprint's signed envelope over every
 * other receipt — its id, signature, manifest hash and the metadata inkprint signed — and the
 * digest of bastion's append-only audit log, with a link to the trail itself. Values are shown in
 * full: they are what a stranger re-checks. Rendered on the server.
 */

function Slip({ kind, serial, children }: { kind: string; serial?: string; children: ReactNode }) {
  return (
    <article className="receipt-torn min-w-0 bg-surface px-5 pt-4 pb-[calc(var(--tear)+1rem)] font-mono text-xs">
      <header className="flex items-baseline justify-between gap-3 text-[11px] uppercase tracking-[0.2em] text-fg-muted">
        <h3>{kind}</h3>
        {serial ? (
          <span translate="no" className="tabular-nums tracking-[0.08em] normal-case">
            #{serial}
          </span>
        ) : null}
      </header>
      <div className="receipt-rule mt-3 pt-3">{children}</div>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-x-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-fg-muted">{label}</dt>
      <dd translate="no" className="break-all text-foreground tabular-nums">
        {value ?? "—"}
      </dd>
    </div>
  );
}

function Missing({ children }: { children: ReactNode }) {
  return <p className="leading-relaxed text-fg-muted">{children}</p>;
}

export function EnvelopeReceipt({ envelope }: { envelope: Section<EnvelopeView> }) {
  if (envelope.kind !== "ok") {
    return (
      <Slip kind="inkprint envelope">
        <Missing>
          {envelope.kind === "none"
            ? "No envelope: the run did not reach it, or nothing was certified to seal."
            : envelope.detail}
        </Missing>
      </Slip>
    );
  }
  const e = envelope.value;
  return (
    <Slip kind="inkprint envelope" serial={e.id.slice(0, 8)}>
      <dl className="space-y-2">
        <Field label="envelope" value={e.id} />
        <Field label="signature" value={e.signature} />
        <Field label="manifest hash" value={e.manifestHash} />
        <Field label="sealed" value={e.createdAt} />
        <Field label="certificates" value={`${e.certificateIds.length} sealed in order`} />
        <Field label="transcript hash" value={e.transcriptHash} />
        <Field label="perf hash" value={e.perfHash} />
      </dl>
      <p className="receipt-rule mt-3 pt-3 text-[11px] uppercase tracking-[0.18em] text-fg-muted">
        signed metadata
      </p>
      <dl className="mt-2 space-y-2">
        {e.metadata.map(([key, value]) => (
          <Field key={key} label={key} value={value === "" ? "(empty)" : value} />
        ))}
      </dl>
    </Slip>
  );
}

export function AuditReceipt({
  audit,
  requestId,
}: {
  audit: Section<AuditView>;
  requestId: string;
}) {
  return (
    <Slip kind="bastion audit" serial={requestId.slice(0, 8)}>
      {audit.kind === "ok" ? (
        <dl className="space-y-2">
          <Field label="digest" value={audit.value.digest} />
          <Field
            label="covers"
            value={`${audit.value.eventCount} events, up to #${audit.value.upToEventId}`}
          />
          <Field label="request" value={audit.value.requestId} />
        </dl>
      ) : (
        <Missing>
          {audit.kind === "none"
            ? "No audit receipt yet: the record stage digests the log at the very end."
            : audit.detail}
        </Missing>
      )}
      <p className="mt-3 text-fg-muted">
        Every gateway call this dossier made, under one request id, append-only.
      </p>
      <AuditLink requestId={requestId} className="mt-2 inline-block" />
    </Slip>
  );
}
