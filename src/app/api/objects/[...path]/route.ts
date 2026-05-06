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
