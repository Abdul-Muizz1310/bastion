"use client";

import Link from "next/link";

/**
 * The app's error boundary (Ruling AH): something in bastion's own rendering threw. It says so
 * plainly, never shows the error's message (it can carry internals), gives the digest the server
 * logged so a report can name it, and offers a retry and a way home.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-16 md:px-6"
    >
      <p aria-hidden="true" className="font-mono text-xs text-fg-muted">
        ~/muizz-lab/bastion <span className="text-error">$</span> exit 1
      </p>
      <h1 className="mt-5 font-display text-[2.2rem] leading-[1.05] font-bold tracking-[-0.02em] sm:text-5xl">
        this page broke on bastion’s side.
      </h1>
      <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-fg-muted text-pretty">
        Not a product failing, and nothing you did: bastion threw while drawing this page. The error
        is in the server log{error.digest ? " under the reference below" : ""}. Trying again often
        works; if it does not, the map still does.
      </p>
      {error.digest ? (
        <p className="mt-4 font-mono text-xs text-fg-muted">
          reference{" "}
          <span translate="no" className="text-foreground tabular-nums">
            {error.digest}
          </span>
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center gap-4 font-mono text-xs">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-9 items-center rounded-[3px] border border-accent-violet/70 bg-accent-violet-soft px-3.5 py-2 text-accent-violet transition-colors hover:bg-accent-violet hover:text-background"
        >
          try again
        </button>
        <Link
          href="/"
          className="text-fg-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          back to the map
        </Link>
      </div>
    </main>
  );
}
