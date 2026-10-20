/**
 * The schema's enumerations as plain constants (spec 21 §6.2, §6.3), with no ORM import, so the
 * browser can name stages and statuses without loading the database schema. `./schema` builds its
 * columns from these and re-exports them.
 */

export const EVIDENCE_KINDS = ["web", "passage", "table"] as const;
export const DOSSIER_STAGES = [
  "wake",
  "gather",
  "read",
  "seal",
  "debate",
  "measure",
  "envelope",
  "record",
] as const;
export const STEP_STATUSES = ["pending", "running", "waiting", "ok", "error", "skipped"] as const;
export const DOCUMENT_KINDS = ["sample", "upload"] as const;
export const RECEIPT_KINDS = ["certificate", "transcript", "perf", "envelope", "audit"] as const;
