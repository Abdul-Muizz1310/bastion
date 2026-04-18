"use client";

import { useState } from "react";

type VerifyResult = {
  certificate_id: string;
  valid: boolean;
  checks: {
    signature: boolean;
    hash: boolean;
    simhash?: boolean;
    embedding?: boolean;
  };
  reason?: string;
};

type VerifyResponse = {
  dossier_id: string;
  overall_valid: boolean | null;
  message?: string;
  results: VerifyResult[];
  verified_at: string;
};

type Props = {
  dossierId: string;
  canVerify: boolean;
};

export function VerifyButton({ dossierId, canVerify }: Props) {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    if (!canVerify || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/dossiers/${dossierId}/verify`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body?.error === "string" ? body.error : `Verify failed (${res.status})`);
        setLoading(false);
        return;
      }
      setResponse((await res.json()) as VerifyResponse);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network_error");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-fg-muted">
          signatures
        </span>
        {response ? <OverallBadge response={response} /> : null}
      </div>

      {!response && !loading ? (
        <button
          type="button"
          onClick={handleVerify}
          disabled={!canVerify}
          className="w-full rounded-lg border border-accent-violet/40 bg-accent-violet-soft px-4 py-2.5 font-mono text-sm text-accent-violet transition-all hover:bg-accent-violet/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ▸ verify all signatures
        </button>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 font-mono text-sm text-fg-muted">
          <span className="pulse-ring inline-block h-2 w-2 rounded-full bg-accent-violet" />
          verifying signatures…
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-error/30 bg-error/5 px-4 py-2 font-mono text-xs text-error">
          verify failed · {error}
        </p>
      ) : null}

      {response && response.results.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {response.results.map((r) => (
            <div
              key={r.certificate_id}
              className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border/60 px-4 py-2 last:border-b-0 font-mono text-xs"
            >
              <span className="text-fg-muted truncate">{r.certificate_id}</span>
              <CheckBadge result={r} />
            </div>
          ))}
        </div>
      ) : null}

      {response && response.message === "no_evidence_yet" ? (
        <p className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-2 font-mono text-xs text-warning">
          no evidence to verify · dossier pipeline has not persisted cert ids yet
        </p>
      ) : null}
    </div>
  );
}

function OverallBadge({ response }: { response: VerifyResponse }) {
  if (response.overall_valid === true) {
    return (
      <span className="rounded-lg border border-success/40 bg-success/10 px-3 py-1 font-mono text-xs uppercase text-success">
        ✓ verified
      </span>
    );
  }
  if (response.overall_valid === false) {
    return (
      <span className="rounded-lg border border-error/40 bg-error/10 px-3 py-1 font-mono text-xs uppercase text-error">
        ✗ tampered
      </span>
    );
  }
  return (
    <span className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-1 font-mono text-xs uppercase text-warning">
      — no evidence
    </span>
  );
}

function CheckBadge({ result }: { result: VerifyResult }) {
  if (result.valid) {
    return (
      <span className="rounded border border-success/40 bg-success/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-success">
        ok
      </span>
    );
  }
  return (
    <span className="rounded border border-error/40 bg-error/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-error">
      {result.reason ?? "fail"}
    </span>
  );
}
