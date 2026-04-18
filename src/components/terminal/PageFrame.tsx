import type { ReactNode } from "react";
import { AppNav, type NavRole } from "./AppNav";
import { StatusBar } from "./StatusBar";

export function PageFrame({
  active,
  children,
  statusLeft,
  statusRight,
  role,
  userEmail,
}: {
  active?: string;
  children: ReactNode;
  statusLeft?: string;
  statusRight?: string;
  role?: NavRole;
  userEmail?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppNav active={active} role={role} userEmail={userEmail} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 md:px-6">{children}</main>
      <StatusBar left={statusLeft} right={statusRight} />
    </div>
  );
}
