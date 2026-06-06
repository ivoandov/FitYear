"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RotateCcw, Home } from "lucide-react";

/**
 * Error boundary for the (app) route group. Two jobs:
 *
 * 1. Auto-heal deploy skew. After a new deployment, a client that's been open
 *    on the previous build references chunk filenames that no longer exist, so
 *    navigating to a route fails with a ChunkLoadError ("this page couldn't
 *    load"). The app had NO error boundary, so that dead-ended. Here we detect
 *    that class of error and reload once to pull the current build. A timestamp
 *    guard prevents reload loops if a reload doesn't fix it.
 * 2. For any other client error, show a recoverable UI (Try again / Home)
 *    instead of a blank/dead screen.
 */
function isChunkLoadError(error: Error | undefined): boolean {
  const s = `${error?.name ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return (
    s.includes("chunkloaderror") ||
    s.includes("loading chunk") ||
    s.includes("loading css chunk") ||
    s.includes("failed to fetch dynamically imported module") ||
    s.includes("importing a module script failed") ||
    s.includes("error loading dynamically imported module")
  );
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunkError = isChunkLoadError(error);

  useEffect(() => {
    if (chunkError) {
      // Reload at most once per ~10s to avoid loops if the reload doesn't help.
      const KEY = "fy_chunk_reload_ts";
      const last = Number(sessionStorage.getItem(KEY) || "0");
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
        return;
      }
    }
    console.error("[app error boundary]", error);
  }, [chunkError, error]);

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        <h1 className="text-xl font-bold">
          {chunkError ? "Updating to the latest version…" : "Something went wrong"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {chunkError
            ? "A new version of FitYear is available. If this screen stays, tap Reload."
            : "This screen hit an unexpected error. Your workout data is safe."}
        </p>
        <div className="flex gap-2 justify-center">
          <Button onClick={() => reset()}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Try again
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              window.location.href = "/";
            }}
          >
            <Home className="h-4 w-4 mr-2" />
            Home
          </Button>
        </div>
      </div>
    </div>
  );
}
