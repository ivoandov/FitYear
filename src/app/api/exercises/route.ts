import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { exercises, insertExerciseSchema } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { rewriteImageUrl } from "@/lib/image-url";
import { normalizeMuscleGroups } from "@/lib/muscle-groups";
import { matchExercise } from "@/lib/exercise-match";
import { canonicalExerciseName } from "@/lib/exercise-naming";

// Per-user response — never cache.
export const dynamic = "force-dynamic";

/**
 * Returns the full shared exercise catalog to every authenticated user: the
 * seeded default library (user_id IS NULL) plus every user-created exercise, so
 * friends can see each other's custom exercises. Editing/deleting/regenerating
 * stays owner-only (enforced in [id]/route.ts + regenerate routes); the default
 * library is read-only for everyone. `isPublic` is no longer used for
 * visibility — it's kept as a legacy column.
 *
 * Legacy image_url paths are rewritten via rewriteImageUrl (shared with the
 * exercise progress page) to point at the GCS proxy at `/api/objects/...`.
 * The DB is not mutated — this is a presentation-layer translation.
 */

export const GET = handle(async () => {
  await requireUser();
  const rows = await db.select().from(exercises);
  return rows.map((r) => ({ ...r, imageUrl: rewriteImageUrl(r.imageUrl) }));
});

const CreateOptionsSchema = z.object({
  // Deliberate-duplicate escape hatch: the client saw the 409 match and the
  // user chose "create anyway" (or FitBot decided the movement is distinct).
  force: z.boolean().optional(),
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const json = await request.json();
  // `name` derives from a text column, so it was unbounded - and it lands in
  // the SHARED catalog that is pasted into every user's FitBot prompt.
  // `imageUrl` is omitted because only the Imagen pipeline writes it: a
  // client-supplied external URL reaches every user (the catalog is shared) and
  // next/image has no remotePatterns, so one crafted row error-boundaries
  // /exercises for the whole user base. `userId`/`isPublic` are overridden
  // below, but omitting them here keeps the contract explicit.
  const parsed = insertExerciseSchema
    .omit({ userId: true, isPublic: true, imageUrl: true })
    .extend({
      name: z.string().trim().min(1).max(60),
      description: z.string().max(2000),
      exerciseType: z.enum(["weight_reps", "distance_time"]).optional(),
    })
    .parse(json);
  const { force } = CreateOptionsSchema.parse(json);

  // Canonicalize the NAME before anything else looks at it, so every creation
  // path - the manual dialog, FitBot's reconcile-on-Start, the plan importer -
  // lands the same movement on the same spelling. Done BEFORE the duplicate
  // guard on purpose: reformatting "Bicep Curls - Cable" to "Cable Bicep
  // Curls" is exactly what lets the matcher recognise it as an existing row.
  parsed.name = canonicalExerciseName(parsed.name);

  // Duplicate guard: a name that confidently matches an existing catalog row is
  // rejected with the match so the caller can reuse it (or re-POST with
  // force:true to create deliberately). Keeps every creation path — the manual
  // dialog AND FitBot's reconcile-on-Start — from fragmenting history across
  // near-duplicate rows.
  if (!force) {
    const catalog = await db
      .select({ id: exercises.id, name: exercises.name })
      .from(exercises);
    const match = matchExercise(parsed.name, catalog);
    if (match) {
      return new Response(
        JSON.stringify({
          error: "duplicate",
          message: `An exercise like this already exists: ${match.name}`,
          match,
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    }
  }

  const [created] = await db
    .insert(exercises)
    .values({
      ...parsed,
      // Canonicalize muscle groups on write (manual create + AI reconcile-on-Start
      // both POST here) so the catalog never accretes freeform/case-variant tags.
      muscleGroups: normalizeMuscleGroups(
        Array.isArray(parsed.muscleGroups)
          ? parsed.muscleGroups.filter((m): m is string => typeof m === "string")
          : [],
      ),
      userId: user.id,
      // User-created exercises are shared (visible to all), editable only by
      // the creator. isPublic is legacy; kept true for consistency.
      isPublic: true,
    })
    .returning();

  return new Response(JSON.stringify(created), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
});
