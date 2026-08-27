import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  exercises,
  routines,
  routineEntries,
  workoutTemplates,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { matchExercise, normalizeExerciseName } from "@/lib/exercise-match";
import { normalizeMuscleGroups } from "@/lib/muscle-groups";
import {
  ImportedPlanSchema,
  planExerciseNames,
  repeatPlanDays,
  type ImportedExercise,
  type ResolvedExerciseReport,
} from "@/lib/import-schema";

/**
 * Stage 2 of import: reconcile the parsed plan against the catalog and write it.
 *
 * Deliberately does NO model work, so it never shares an invocation budget with
 * the parse call - the same split the program builder uses.
 *
 * The plan is re-validated here rather than trusted from the client: the parse
 * route's output goes through the browser, so this is the real trust boundary.
 *
 * Exercise identity is the whole point of this route. An imported "DB Bench
 * Press" must become the SAME catalog row the user already has history on, or
 * the import quietly fragments their records. So each name goes through the
 * app's own fuzzy matcher first (order- and plural-insensitive, abbreviation
 * folding, threshold 0.8), and only genuinely new movements are created.
 */
export const maxDuration = 60;

const InputSchema = z.object({
  plan: ImportedPlanSchema,
  /** Optional override so the user can rename before saving. */
  name: z.string().trim().min(1).max(80).optional(),
  /**
   * Per-exercise decisions the user confirmed in the preview, keyed by the
   * imported name. An id means "use this existing exercise"; an explicit null
   * means "create it as new".
   *
   * This exists because automatic matching alone is not good enough here. The
   * 0.8 threshold is deliberately conservative and must not be lowered (0.67 is
   * also the score of Split vs Bulgarian Split Squat), so an import of
   * "Barbell Bench Press", "Back Squat" or "Romanian Deadlift" would silently
   * create near-duplicates of rows the user already has - re-fragmenting the
   * catalog the 2026-07-17 dedupe cleaned up. Letting the model snap names to
   * the catalog instead is worse: it turned "Incline dumbbell press" into a
   * curl. So near-matches are shown and the user decides.
   */
  mappings: z.record(z.string(), z.string().nullable()).optional(),
  /**
   * How long the routine should RUN, in days. An imported plan is usually one
   * cycle (a week), but a program runs for 30 or 60, so the pattern is repeated
   * to fill this. Omitted means "exactly as imported". Ignored for a single
   * workout, which has no duration.
   */
  durationDays: z.number().int().min(1).max(365).optional(),
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const { plan, name: nameOverride, mappings, durationDays } = InputSchema.parse(await request.json());

  const catalog = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises);

  // Resolve every distinct name ONCE, so a movement appearing on five days
  // creates at most one catalog row and always resolves to the same id.
  const resolved = new Map<string, ResolvedExerciseReport>();
  const report: ResolvedExerciseReport[] = [];

  // Metadata for names we may have to create, taken from the first occurrence.
  const metaByName = new Map<string, ImportedExercise>();
  const collectMeta = (ex: ImportedExercise) => {
    const key = normalizeExerciseName(ex.name);
    if (!metaByName.has(key)) metaByName.set(key, ex);
  };
  if (plan.kind === "workout") plan.exercises.forEach(collectMeta);
  else plan.days.forEach((d) => d.exercises.forEach(collectMeta));

  for (const importedName of planExerciseNames(plan)) {
    const key = normalizeExerciseName(importedName);
    if (resolved.has(key)) continue;

    // An explicit user decision wins over the automatic match.
    const chosenId = mappings?.[importedName];
    if (chosenId) {
      // Verified against the catalog rather than trusted: this id comes from
      // the browser.
      const chosen = catalog.find((c) => c.id === chosenId);
      if (chosen) {
        const entry: ResolvedExerciseReport = {
          imported: importedName,
          resolved: chosen.name,
          action: "matched",
          exerciseId: chosen.id,
        };
        resolved.set(key, entry);
        report.push(entry);
        continue;
      }
    }

    // An explicit null means the user chose to create it even though something
    // similar exists, so the automatic match is skipped.
    const userForcedCreate = mappings ? mappings[importedName] === null : false;
    const match = userForcedCreate ? null : matchExercise(importedName, catalog);
    if (match) {
      const entry: ResolvedExerciseReport = {
        imported: importedName,
        resolved: match.name,
        action: "matched",
        exerciseId: match.id,
      };
      resolved.set(key, entry);
      report.push(entry);
      continue;
    }

    const meta = metaByName.get(key);
    const [created] = await db
      .insert(exercises)
      .values({
        name: importedName.slice(0, 60),
        // Canonicalized on write like every other creation path, so an import
        // cannot accrete freeform or case-variant muscle tags into the shared
        // catalog.
        muscleGroups: normalizeMuscleGroups(meta?.muscleGroups ?? []),
        description: "Imported",
        exerciseType: meta?.exerciseType ?? "weight_reps",
        userId: user.id,
        isPublic: true,
      })
      .returning({ id: exercises.id, name: exercises.name });

    // Added to the in-memory catalog so a near-duplicate later in the SAME
    // import matches this new row instead of creating a second copy.
    catalog.push({ id: created.id, name: created.name });

    const entry: ResolvedExerciseReport = {
      imported: importedName,
      resolved: created.name,
      action: "created",
      exerciseId: created.id,
    };
    resolved.set(key, entry);
    report.push(entry);
  }

  const resolveOne = (ex: ImportedExercise) => {
    const entry = resolved.get(normalizeExerciseName(ex.name));
    return {
      id: entry?.exerciseId,
      name: entry?.resolved ?? ex.name,
      muscleGroups: normalizeMuscleGroups(ex.muscleGroups ?? []),
      exerciseType: ex.exerciseType,
      sets: ex.sets,
      reps: ex.reps,
      rest: ex.rest,
      notes: ex.notes,
    };
  };

  if (plan.kind === "workout") {
    const [created] = await db
      .insert(workoutTemplates)
      .values({
        userId: user.id,
        name: (nameOverride ?? plan.name).slice(0, 80),
        exercises: plan.exercises.map(resolveOne) as unknown as never,
      })
      .returning();

    return new Response(
      JSON.stringify({
        kind: "workout",
        templateId: created.id,
        name: created.name,
        exercisesMatched: report.filter((r) => r.action === "matched").length,
        exercisesCreated: report.filter((r) => r.action === "created").length,
        report,
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  }

  // Repeat the imported cycle to fill the requested run length. Importing one
  // week and asking for 30 days materialises 30 days of entries; importing a
  // real 30-day program and asking for 30 changes nothing.
  const planDays = durationDays
    ? repeatPlanDays(plan.days, plan.cycleLength, durationDays)
    : plan.days;

  // Routine: parent + its days in ONE transaction. A failed entries insert must
  // not leave an empty routine behind (the same guarantee ai/save-program has).
  const trainingDays = planDays.filter((d) => !d.isRest && d.exercises.length > 0);
  const routine = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(routines)
      .values({
        userId: user.id,
        name: (nameOverride ?? plan.name).slice(0, 80),
        description: "Imported",
        defaultDurationDays: planDays.length,
        // Drives the true rotation strip on the Routines card.
        cycleLength: plan.cycleLength,
        isPublic: false,
      })
      .returning();

    if (trainingDays.length) {
      await tx.insert(routineEntries).values(
        trainingDays.map((d) => ({
          routineId: row.id,
          dayIndex: d.dayIndex,
          workoutName: d.workoutName,
          exercises: d.exercises.map(resolveOne) as unknown as never,
        })),
      );
    }
    return row;
  });

  return new Response(
    JSON.stringify({
      kind: "routine",
      routineId: routine.id,
      name: routine.name,
      cycleLength: plan.cycleLength,
      daysGenerated: trainingDays.length,
      durationDays: planDays.length,
      exercisesMatched: report.filter((r) => r.action === "matched").length,
      exercisesCreated: report.filter((r) => r.action === "created").length,
      report,
    }),
    { status: 201, headers: { "content-type": "application/json" } },
  );
});
