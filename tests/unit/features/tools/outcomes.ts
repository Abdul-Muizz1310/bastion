import type { ToolOutcome } from "@/features/tools/outcome";

/** Test-only builders for a workbench's seeded results. */

export const RID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

export function ok<T>(data: T, requestId: string = RID, status = 200): ToolOutcome<T> {
  return { ok: true, data, status, requestId };
}

/** Every link to an audit trail in the markup. */
export function auditHrefs(html: string): string[] {
  return [...html.matchAll(/href="(\/audit\/[^"]+)"/g)].map((m) => m[1] ?? "");
}

/** Every copy button's accessible name. */
export function copyButtons(html: string): string[] {
  return [...html.matchAll(/aria-label="(copy [^"]+)"/g)].map((m) => m[1] ?? "");
}
