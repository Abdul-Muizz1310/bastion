import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";

const STEPS = [
  { name: "magpie", label: "Scrape HN article", icon: "▶" },
  { name: "inkprint", label: "Sign C2PA certificate", icon: "▶" },
  { name: "paper-trail", label: "Run AI debate", icon: "▶" },
  { name: "slowquery", label: "Capture slow queries", icon: "▶" },
  { name: "audit", label: "Collect audit trail", icon: "▶" },
];

export default function RunPage() {
  return (
    <PageFrame active="demo">
      <div className="space-y-8">
        <div>
          <p className="font-mono text-xs text-fg-faint">{"// integrated_demo"}</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold tracking-tight md:text-4xl">
            End-to-End <span className="text-accent-violet">Demo</span>
          </h1>
          <p className="mt-2 font-mono text-sm text-fg-muted">
            Run a cross-service workflow through all 5 services via the bastion gateway.
          </p>
        </div>

        <TerminalWindow title="demo_runner" status="green">
          <div className="space-y-4">
            <div className="space-y-2">
              {STEPS.map((step, i) => (
                <div
                  key={step.name}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background/40 px-4 py-3 transition-colors hover:border-border-bright"
                >
                  <span className="font-mono text-xs text-fg-faint">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-fg-faint">{step.icon}</span>
                  <div className="flex-1">
                    <span className="font-mono text-sm font-semibold">{step.name}</span>
                    <span className="ml-2 font-mono text-xs text-fg-muted">{step.label}</span>
                  </div>
                  <span className="rounded-md border border-border px-2 py-0.5 font-mono text-[10px] text-fg-faint">
                    pending
                  </span>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="w-full rounded-lg bg-gradient-to-r from-accent-violet to-accent-rose px-4 py-3 font-mono text-sm font-semibold text-background transition-all hover:shadow-[0_0_30px_rgb(167_139_250_/_0.25)]"
            >
              ▶ Run end-to-end platform demo
            </button>

            <p className="text-center font-mono text-[11px] text-fg-faint">
              requires admin or editor role · calls all services via gateway
            </p>
          </div>
        </TerminalWindow>
      </div>
    </PageFrame>
  );
}
