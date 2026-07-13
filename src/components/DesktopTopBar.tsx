"use client";

/**
 * The slim desktop top bar of the A+ refresh (md+ only). Each screen renders one
 * at the top of its content: the page title (or a mono eyebrow + greeting on
 * Home) on the left, screen-specific actions on the right. It sticks to the top
 * of the scrolling `<main>` while content scrolls beneath it. On mobile it's
 * hidden; each page keeps its own mobile header (`md:hidden`).
 */
export function DesktopTopBar({
  title,
  eyebrow,
  children,
}: {
  title: React.ReactNode;
  eyebrow?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-30 hidden h-[72px] shrink-0 items-center justify-between gap-4 border-b border-divider bg-background/90 px-9 backdrop-blur-md md:flex">
      <div className="flex min-w-0 items-center gap-3">
        {eyebrow ? (
          <>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
              {eyebrow}
            </span>
            <span className="h-1 w-1 shrink-0 rounded-full bg-tertiary-foreground" />
          </>
        ) : null}
        <div className="truncate text-lg font-bold tracking-[-0.01em] text-foreground">
          {title}
        </div>
      </div>
      {children ? <div className="flex items-center gap-3">{children}</div> : null}
    </div>
  );
}
