import type { ReactNode } from "react";
import { AppNav, type NavKey } from "./AppNav";
import { StatusBar } from "./StatusBar";

/** Every page's frame (spec 21 §3.1): skip link, primary nav, the main landmark, the status bar. */
export function PageFrame({
  active,
  children,
  statusLeft,
  statusRight,
}: {
  active?: NavKey;
  children: ReactNode;
  statusLeft?: string;
  statusRight?: string;
}) {
  return (
    <div className="relative z-[2] flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-30 bg-accent-violet px-3 py-2 font-mono text-sm text-background focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        skip to content
      </a>
      <AppNav active={active} />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 md:px-6">
        {children}
      </main>
      <StatusBar left={statusLeft} right={statusRight} />
    </div>
  );
}
