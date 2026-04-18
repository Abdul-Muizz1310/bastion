const MAX_RETURN_TO_LENGTH = 512;
const DEFAULT_FALLBACK = "/dashboard";

function isSafePath(raw: string): boolean {
  if (!raw.startsWith("/")) return false;
  if (raw.startsWith("//")) return false;
  if (raw.startsWith("/\\")) return false;
  if (raw.includes("://")) return false;
  if (raw.includes("@")) return false;
  if (/[\r\n\0]/.test(raw)) return false;
  return true;
}

export function isSafeReturnTo(raw: string | null | undefined): raw is string {
  if (typeof raw !== "string") return false;
  if (raw.length === 0 || raw.length > MAX_RETURN_TO_LENGTH) return false;

  if (!isSafePath(raw)) return false;

  // Defense-in-depth: decode once and re-validate to catch %2F%2F etc.
  // decodeURIComponent can throw on malformed input — treat that as unsafe.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return false;
  }
  if (decoded !== raw && !isSafePath(decoded)) return false;

  return true;
}

export function getSafeReturnTo(
  raw: string | null | undefined,
  fallback: string = DEFAULT_FALLBACK,
): string {
  return isSafeReturnTo(raw) ? raw : fallback;
}
