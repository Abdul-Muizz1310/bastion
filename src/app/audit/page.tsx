import { PageFrame } from "@/components/terminal/PageFrame";

const MOCK_EVENTS = [
  { id: 1, action: "auth.login_demo", actor: "demo-admin", service: "bastion", time: "2s ago" },
  { id: 2, action: "gateway.proxy", actor: "demo-admin", service: "magpie", time: "5s ago" },
  { id: 3, action: "demo.magpie.ok", actor: "demo-admin", service: "magpie", time: "6s ago" },
  { id: 4, action: "gateway.proxy", actor: "demo-admin", service: "inkprint", time: "8s ago" },
  { id: 5, action: "demo.inkprint.ok", actor: "demo-admin", service: "inkprint", time: "10s ago" },
];

export default function AuditPage() {
  return (
    <PageFrame active="audit">
      <div className="space-y-6">
        <div>
          <p className="font-mono text-xs text-fg-faint">{"// audit_log"}</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold tracking-tight md:text-4xl">
            Audit <span className="text-accent-violet">Log</span>
          </h1>
          <p className="mt-2 font-mono text-sm text-fg-muted">
            Append-only cross-service event log. Filterable by service, action, and date.
          </p>
        </div>

        <div className="flex gap-2">
          {["all", "bastion", "magpie", "inkprint", "paper-trail", "slowquery"].map((f) => (
            <button
              key={f}
              type="button"
              className={`rounded-md border px-3 py-1 font-mono text-xs transition-colors ${
                f === "all"
                  ? "border-accent-violet/40 bg-accent-violet-soft text-accent-violet"
                  : "border-border bg-background/60 text-fg-muted hover:border-border-bright"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-surface/50">
          <div className="grid grid-cols-[2rem_1fr_8rem_6rem_5rem] gap-2 border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-fg-faint">
            <span>#</span>
            <span>action</span>
            <span>actor</span>
            <span>service</span>
            <span>time</span>
          </div>
          {MOCK_EVENTS.map((e) => (
            <div
              key={e.id}
              className="grid grid-cols-[2rem_1fr_8rem_6rem_5rem] gap-2 border-b border-border px-4 py-2.5 font-mono text-sm transition-colors hover:bg-surface-hover"
            >
              <span className="text-fg-faint">{e.id}</span>
              <span className="text-foreground">{e.action}</span>
              <span className="text-fg-muted">{e.actor}</span>
              <span className="text-accent-violet">{e.service}</span>
              <span className="text-fg-faint">{e.time}</span>
            </div>
          ))}
        </div>

        <p className="text-center font-mono text-[11px] text-fg-faint">
          append-only · INSERT only at DB level · no UPDATE or DELETE
        </p>
      </div>
    </PageFrame>
  );
}
