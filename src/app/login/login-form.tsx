"use client";

import { useActionState } from "react";
import { demoSignInAction, sendMagicLinkAction } from "@/app/actions";
import type { Role } from "@/lib/validation";

export function LoginForm({ demoMode }: { demoMode: boolean }) {
  const [state, formAction, isPending] = useActionState(
    async (
      _prev: { error?: string; sent?: boolean; magicLinkUrl?: string },
      formData: FormData,
    ) => {
      /* v8 ignore next */
      return sendMagicLinkAction(formData);
    },
    {},
  );

  if (state.sent) {
    return (
      <div className="terminal-glow rounded-xl border border-border bg-surface p-6 text-center">
        <div className="mb-3 text-2xl">✉️</div>
        <p className="font-mono text-sm text-foreground">Magic link created</p>
        {state.magicLinkUrl ? (
          <div className="mt-3 space-y-3">
            <p className="font-mono text-xs text-fg-muted">Demo mode — click below to sign in:</p>
            <a
              href={state.magicLinkUrl}
              className="inline-block rounded-lg bg-gradient-to-r from-accent-violet to-accent-rose px-5 py-2 font-mono text-sm font-semibold text-background transition-all hover:shadow-[0_0_30px_rgb(167_139_250_/_0.25)]"
            >
              open magic link
            </a>
            <p className="font-mono text-[10px] text-fg-faint break-all">{state.magicLinkUrl}</p>
          </div>
        ) : (
          <p className="mt-2 font-mono text-xs text-fg-muted">
            Check your email and click the link to sign in.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="terminal-glow rounded-xl border border-border bg-surface p-6">
      <form action={formAction} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block font-mono text-xs uppercase tracking-[0.15em] text-fg-muted"
          >
            email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-lg border border-border bg-background/60 px-4 py-2.5 font-mono text-sm text-foreground placeholder-fg-faint transition-colors focus:border-accent-violet/60 focus:outline-none focus:shadow-[0_0_0_1px_rgb(167_139_250_/_0.3),0_0_30px_rgb(167_139_250_/_0.15)]"
          />
        </div>
        {state.error && <p className="font-mono text-xs text-error">{state.error}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-gradient-to-r from-accent-violet to-accent-rose px-4 py-2.5 font-mono text-sm font-semibold text-background transition-all hover:shadow-[0_0_30px_rgb(167_139_250_/_0.25)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "sending..." : "send magic link"}
        </button>
      </form>

      {demoMode && (
        <>
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">
              or sign in as
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["admin", "editor", "viewer"] as const).map((role) => (
              <DemoButton key={role} role={role} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DemoButton({ role }: { role: Role }) {
  async function handleClick() {
    /* v8 ignore next */
    await demoSignInAction(role);
  }

  return (
    <form action={handleClick}>
      <button
        type="submit"
        className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-center font-mono text-xs transition-colors hover:border-accent-violet/40 hover:bg-surface-hover"
      >
        <span className="text-accent-violet">{role}</span>
      </button>
    </form>
  );
}
