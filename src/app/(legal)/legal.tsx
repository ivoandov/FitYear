import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared chrome for the two public legal pages.
 *
 * They sit OUTSIDE the (app) route group on purpose: that group's layout mounts
 * Providers, the nav and the timer pill, all of which assume a signed-in user.
 * These pages must render for a signed-out visitor, an App Review reviewer and
 * Google's OAuth consent screen crawler, none of whom have a session.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-14">
      <Link
        href="/"
        className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary hover:opacity-80"
      >
        FitYear
      </Link>
      <h1 className="mt-6 text-3xl font-bold tracking-[-0.02em]">{title}</h1>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-tertiary-foreground">
        Last updated {updated}
      </p>
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-muted-foreground [&_a]:text-primary [&_a:hover]:opacity-80 [&_h2]:mt-10 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:mt-1.5 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
      <p className="mt-14 border-t border-divider pt-6 text-[13px] text-tertiary-foreground">
        Questions? Email{" "}
        <a href="mailto:ivo@marketeq.co" className="text-primary">
          ivo@marketeq.co
        </a>
        .
      </p>
    </main>
  );
}
