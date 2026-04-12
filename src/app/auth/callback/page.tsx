import { redirect } from "next/navigation";
import { consumeCallbackToken } from "@/app/actions";

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    redirect("/login");
  }

  const result = await consumeCallbackToken(token);

  // If consumeCallbackToken succeeds it redirects internally.
  // If we reach here, there was an error.
  return (
    <div className="flex min-h-screen items-center justify-center bg-background bg-grid bg-scanlines px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 text-center">
        <p className="font-mono text-sm text-error">{result.error ?? "Invalid or expired link"}</p>
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
