import { LoginForm } from "./login-form";

const DEMO_MODE = process.env.DEMO_MODE === "true";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_token: "Magic link is invalid or has expired. Please try again.",
  server_error: "Something went wrong. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? "An error occurred.") : undefined;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background bg-grid bg-scanlines px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-accent-violet"
            >
              <title>Bastion shield</title>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            </svg>
          </div>
          <h1 className="font-mono text-3xl font-semibold tracking-tight">bastion</h1>
          <p className="mt-2 font-mono text-sm text-fg-muted">control plane · identity · audit</p>
        </div>

        {errorMessage && (
          <div className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-center">
            <p className="font-mono text-xs text-error">{errorMessage}</p>
          </div>
        )}

        <LoginForm demoMode={DEMO_MODE} />

        <p className="text-center font-mono text-[11px] text-fg-faint">
          <span className="cursor-blink mr-1 inline-block h-3 w-1.5 bg-accent-violet/60" />
          {DEMO_MODE
            ? "demo mode active · no real credentials required"
            : "enter your email to receive a magic link"}
        </p>
      </div>
    </div>
  );
}
