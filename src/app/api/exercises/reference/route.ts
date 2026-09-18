import { NextRequest } from "next/server";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { searchReference } from "@/lib/exercise-reference";

/**
 * Standard exercise names to suggest while somebody types a new one.
 *
 * A route rather than an import, because the reference data is ~635KB and
 * belongs nowhere near a client bundle. The Add Exercise dialog is a client
 * component; it asks for a handful of matches instead of holding the list.
 *
 * Authenticated even though the vocabulary is not private: it is a shared,
 * uncached lookup, and leaving it open would make it a free search endpoint for
 * anyone who found the URL. Nothing here is user-scoped, so there is no data to
 * leak - only work.
 *
 * Deliberately NOT filtered against the user's catalog here. The dialog already
 * holds the library for its duplicate hint and renders the two groups
 * separately, so filtering server-side would mean shipping the catalog up just
 * to subtract it.
 */
export const GET = handle(async (request: NextRequest) => {
  await requireUser();
  const params = request.nextUrl.searchParams;
  const query = params.get("q")?.trim() ?? "";

  // Below three characters a substring search returns most of 4,099 entries in
  // no useful order. The dialog's own duplicate hint uses the same floor.
  if (query.length < 3) return Response.json([]);

  const hits = searchReference({
    query,
    muscleGroup: params.get("muscleGroup")?.trim() || undefined,
    limit: 6,
  });

  // Only what the dialog renders and prefills from. The rest of an entry
  // (mechanic, force, secondary muscles) is FitBot's business, not this form's.
  return Response.json(
    hits.map((h) => ({
      name: h.name,
      equipment: h.equipment,
      muscles: h.muscles,
    })),
  );
});
