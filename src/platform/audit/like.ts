/**
 * A literal prefix as a LIKE pattern (spec 21 §3.2 invariant 3): `%`, `_` and the escape character
 * itself match only themselves (Postgres' default LIKE escape is `\`). Pure.
 */
export function likePrefix(prefix: string): string {
  if (prefix === "") throw new RangeError("likePrefix: an empty prefix would match everything");
  return `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
