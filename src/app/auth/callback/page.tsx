import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { consumeMagicLink } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/session";

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    redirect("/login");
  }

  let error: string | undefined;
  try {
    const result = await consumeMagicLink(token);
    if (!result) {
      error = "Invalid or expired token";
    } else {
      const jar = await cookies();
      jar.set(COOKIE_NAME, result.session.cookie, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 24 * 60 * 60,
      });
      redirect("/dashboard");
    }
  } catch (err) {
    // redirect() throws NEXT_REDIRECT — rethrow it
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    // Also handle the digest-based redirect check for Next.js 16
    if (typeof err === "object" && err !== null && "digest" in err) throw err;
    error = err instanceof Error ? err.message : "Something went wrong";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background bg-grid bg-scanlines px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 text-center">
        <p className="font-mono text-sm text-error">{error ?? "Invalid or expired link"}</p>
        <a
          href="/login"
          className="mt-4 inline-block font-mono text-xs text-accent-violet hover:underline"
        >
          back to login
        </a>
      </div>
    </div>
  );
}
