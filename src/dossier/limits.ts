/**
 * What a dossier may hold (spec 21 §3, §6.1), as plain constants with no I/O, so the compose form
 * checks exactly what `POST /api/dossiers` enforces (`./create` re-exports them) and names the
 * rounds each mode buys (`./stages/debate` runs them).
 */

export const MAX_CLAIM = 1024;
export const MAX_SOURCES = 5;
export const MAX_DOCUMENTS = 3;
export const MODES = ["rapid", "standard", "adversarial"] as const;
export type Mode = (typeof MODES)[number];

/** paper-trail rounds per mode. */
export const ROUNDS: Readonly<Record<Mode, number>> = { rapid: 1, standard: 2, adversarial: 3 };
