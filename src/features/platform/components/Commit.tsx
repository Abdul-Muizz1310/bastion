import type { CommitFact } from "../facts";

/** A commit as `/platform` writes it (spec 21 §3.2): linked when it is a SHA, else plain text. */
export function Commit({ commit }: { commit: CommitFact }) {
  switch (commit.kind) {
    case "link":
      return (
        <a
          href={commit.href}
          title={commit.full}
          translate="no"
          className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          {commit.short}
          <span className="sr-only"> (the commit on GitHub)</span>
          <span aria-hidden="true"> ↗</span>
        </a>
      );
    case "text":
      return (
        <span translate="no" className="text-foreground">
          {commit.text}
        </span>
      );
    case "none":
      return <span className="text-fg-muted">not reported</span>;
    default:
      return assertNever(commit);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`platform: unexpected commit ${JSON.stringify(value)}`);
}
