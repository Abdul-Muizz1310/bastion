import Link from "next/link";
import { auditPath } from "./receipt-text";

/** A call's request id, linking to its audit trail (`/audit/<requestId>`). */
export function AuditLink({
  requestId,
  className = "",
}: {
  requestId: string;
  className?: string;
}) {
  return (
    <Link
      href={auditPath(requestId)}
      className={`font-mono text-[11px] text-fg-muted underline decoration-dotted underline-offset-4 transition-colors hover:text-accent-violet ${className}`}
    >
      request{" "}
      <span translate="no" className="tabular-nums">
        {requestId.slice(0, 8)}
      </span>{" "}
      · audit trail
      <span aria-hidden="true"> →</span>
    </Link>
  );
}
