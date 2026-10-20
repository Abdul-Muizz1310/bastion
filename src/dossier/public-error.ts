/**
 * The error text a public surface may carry (spec 21 §6.6, review round 1). Pure. bastion's own
 * internal errors record an exception's message after their code (`stage_threw: <message>`,
 * `invalid_outcome: <message>`), and a message can name hosts, SQL or secrets; so the stream, the
 * page, the receipts bundle and the append-only audit log publish only the bare code. Any other
 * error — a downstream code with the gateway's own detail, a timeout, a limit — is kept as
 * recorded. The full text stays in `dossier_steps.error`, which nothing serves.
 */

export const INTERNAL_ERRORS = ["stage_threw", "invalid_outcome"] as const;

/** A step's error: an internal one reduced to its code. */
export function publicStepError(error: string | null): string | null {
  if (error === null) return null;
  return INTERNAL_ERRORS.find((code) => error === code || error.startsWith(`${code}:`)) ?? error;
}

/** The dossier's `<stage>: <error>` (`dossierError`), its step error reduced the same way. */
export function publicDossierError(error: string | null): string | null {
  if (error === null) return null;
  const at = /^([a-z]+): ([\s\S]*)$/.exec(error);
  if (at === null) return error;
  const [, stage, stepError] = at;
  return `${stage}: ${publicStepError(stepError ?? "")}`;
}
