"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Root error boundary. Catches errors thrown in the root layout or any route
 * outside the (app) group (e.g. /login). Must render its own <html>/<body>
 * because it replaces the root layout. Like (app)/error.tsx it auto-reloads on
 * a deploy-skew ChunkLoadError so an old client picks up the current build.
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

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    if (isChunkLoadError(error)) {
      const KEY = "fy_chunk_reload_ts";
      const last = Number(sessionStorage.getItem(KEY) || "0");
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
        return;
      }
    }
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0B0B0A",
          color: "#f5f5f5",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "360px", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 12px" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#a3a3a3", margin: "0 0 20px" }}>
            FitYear hit an unexpected error. Your data is safe. Try again or
            reload.
          </p>
          <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
            <button
              onClick={() => reset()}
              style={{
                background: "#E5FF00",
                color: "#0A0A0A",
                border: "none",
                borderRadius: "8px",
                padding: "8px 16px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "transparent",
                color: "#f5f5f5",
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: "8px",
                padding: "8px 16px",
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
