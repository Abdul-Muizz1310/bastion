import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";

export default function TimeTravelPage() {
  return (
    <PageFrame active="time-travel">
      <div className="space-y-8">
        <div>
          <p className="font-mono text-xs text-fg-faint">{"// time_travel"}</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold tracking-tight md:text-4xl">
            Time <span className="text-accent-violet">Travel</span>
          </h1>
          <p className="mt-2 font-mono text-sm text-fg-muted">
            Rewind the audit log to any point in time. Admin only.
          </p>
        </div>

        <TerminalWindow title="time_slider">
          <div className="space-y-6">
            <div className="space-y-2">
              <label
                htmlFor="time-slider"
                className="block font-mono text-xs uppercase tracking-[0.15em] text-fg-muted"
              >
                rewind to
              </label>
              <input
                id="time-slider"
                type="range"
                min="0"
                max="100"
                defaultValue="100"
                className="w-full accent-accent-violet"
              />
              <div className="flex justify-between font-mono text-[11px] text-fg-faint">
                <span>earliest event</span>
                <span className="text-accent-violet">now</span>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background/40 p-4">
              <p className="font-mono text-xs text-fg-muted">
                <span className="text-accent-violet">DISTINCT ON</span> (entity_type, entity_id)
              </p>
              <p className="mt-1 font-mono text-xs text-fg-faint">
                SELECT * FROM events WHERE created_at &lt;= $T
                <br />
                ORDER BY entity_type, entity_id, created_at DESC
              </p>
            </div>

            <div className="space-y-2">
              <p className="font-mono text-xs text-fg-muted">entities at selected time:</p>
              <div className="rounded-lg border border-border bg-background/40 p-6 text-center">
                <p className="font-mono text-sm text-fg-faint">drag slider to rewind</p>
                <p className="mt-1 font-mono text-[11px] text-fg-faint">
                  state reconstructed from append-only events
                </p>
              </div>
            </div>
          </div>
        </TerminalWindow>
      </div>
    </PageFrame>
  );
}
