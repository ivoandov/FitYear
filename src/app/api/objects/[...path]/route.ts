import { NextRequest, NextResponse } from "next/server";
import { getSignedReadUrl } from "@/lib/gcs";

type Ctx = { params: Promise<{ path: string[] }> };

/**
 * Serves objects from the GCS bucket via signed URL.
 *
 * Two URL shapes resolve here:
 *   /api/objects/exercises/foo.jpg            → exercises/foo.jpg
 *   /api/objects/public/exercises/foo.jpg     → exercises/foo.jpg (legacy compat)
 *
 * On hit: 302 redirect to a fresh signed read URL.
 * On miss: 404.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  if (!path?.length) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Strip "public/" prefix if present (legacy /objects/public/exercises/... shape)
  const segments = path[0] === "public" ? path.slice(1) : path;
  if (!segments.length) {
    return new NextResponse("Not found", { status: 404 });
  }
  const objectName = segments.join("/");

  // This route is deliberately UNAUTHENTICATED: exercise thumbnails go through
  // next/image, whose optimizer fetches the source server-side with no session
  // cookie, so requiring auth here would break every image in the app. Instead,
  // constrain WHAT it can hand out: only the exercise-image prefix, and no path
  // traversal. Without this it would mint a signed read URL for any object name
  // in the bucket - harmless while the bucket holds only exercise images, but a
  // real leak the moment anything else lands there.
  if (!objectName.startsWith("exercises/") || objectName.includes("..")) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const url = await getSignedReadUrl(objectName, 3600);
    if (!url) {
      return new NextResponse("Not found", { status: 404 });
    }
    return NextResponse.redirect(url, { status: 302 });
  } catch (e) {
    console.error("[/api/objects] error:", (e as Error).message);
    return new NextResponse("Internal error", { status: 500 });
  }
}
