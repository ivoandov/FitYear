import { NextRequest } from "next/server";

// TEMPORARY: verifies Sentry captures uncaught server errors end-to-end
// (Next's onRequestError -> Sentry). Remove after confirming receipt.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id") ?? "noid";
  throw new Error(`SENTRY_VERIFY ${id}`);
}
