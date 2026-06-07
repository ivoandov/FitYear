/**
 * Exercise images are stored in the DB with legacy path shapes
 * (`/objects/public/...` from the Replit migration, or `/generated_images/...`).
 * The GCS-backed proxy that actually serves them lives at `/api/objects/...`,
 * so any path read straight from the DB must be rewritten before it's handed to
 * <img>/<Image>, or it 404s (e.g. `/objects/public/...` -> 404, the broken
 * thumbnail on the exercise progress page).
 *
 * The /api/exercises route applies this to every row on the way out; server
 * components that query the exercises table directly (e.g. /exercises/[id])
 * must call it themselves. Single source of truth so the two never drift.
 */
export function rewriteImageUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/objects/")) return `/api${url}`;
  if (url.startsWith("/generated_images/")) {
    return `/api/objects/exercises/${url.replace("/generated_images/", "")}`;
  }
  return url;
}
