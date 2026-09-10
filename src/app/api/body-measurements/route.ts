import { NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bodyMeasurements } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { scheduledDateFromKey, scheduledDateKey } from "@/lib/date";

/**
 * Body measurements: weight, composition, circumferences, a photo, a note.
 *
 * The date is an AUTHORED DAY. It arrives as a "YYYY-MM-DD" key and is anchored
 * with scheduledDateFromKey, exactly like a scheduled workout, because "my
 * weight on Tuesday" is a day somebody chose and not an instant. Resolving it
 * in the viewer's zone would report a weigh-in a day late from UTC+12.
 */

const CircumferencesSchema = z
  .object({
    chest: z.number().min(0).max(120).optional(),
    waist: z.number().min(0).max(120).optional(),
    hips: z.number().min(0).max(120).optional(),
    leftArm: z.number().min(0).max(60).optional(),
    rightArm: z.number().min(0).max(60).optional(),
    leftThigh: z.number().min(0).max(80).optional(),
    rightThigh: z.number().min(0).max(80).optional(),
  })
  .partial();

const UpsertSchema = z.object({
  /** "YYYY-MM-DD". Zone-free by contract. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Always lbs on the wire, like every other weight in this app. */
  weightLbs: z.number().min(0).max(2000).nullable().optional(),
  bodyFatPct: z.number().min(0).max(100).nullable().optional(),
  circumferences: CircumferencesSchema.nullable().optional(),
  photoPath: z.string().max(500).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const GET = handle(async () => {
  const { user } = await requireUser();
  const rows = await db
    .select()
    .from(bodyMeasurements)
    .where(eq(bodyMeasurements.userId, user.id))
    .orderBy(desc(bodyMeasurements.measuredOn))
    .limit(400);
  return Response.json(
    rows.map((r) => ({
      id: r.id,
      date: scheduledDateKey(r.measuredOn),
      weightLbs: r.weightLbs,
      bodyFatPct: r.bodyFatPct,
      circumferences: r.circumferences ?? null,
      photoPath: r.photoPath,
      notes: r.notes,
    })),
  );
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = UpsertSchema.parse(await request.json());
  const measuredOn = scheduledDateFromKey(body.date);

  // One row per day: weighing yourself twice corrects the day rather than
  // drawing two points. The unique index is the race backstop.
  const [existing] = await db
    .select()
    .from(bodyMeasurements)
    .where(and(eq(bodyMeasurements.userId, user.id), eq(bodyMeasurements.measuredOn, measuredOn)))
    .limit(1);

  // Only fields the caller actually sent are written, so saving a photo does
  // not blank the weight recorded that morning.
  const patch = {
    ...(body.weightLbs !== undefined ? { weightLbs: body.weightLbs } : {}),
    ...(body.bodyFatPct !== undefined ? { bodyFatPct: body.bodyFatPct } : {}),
    ...(body.circumferences !== undefined ? { circumferences: body.circumferences } : {}),
    ...(body.photoPath !== undefined ? { photoPath: body.photoPath } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
  };

  if (existing) {
    const [updated] = await db
      .update(bodyMeasurements)
      .set(patch)
      .where(eq(bodyMeasurements.id, existing.id))
      .returning();
    return Response.json({ id: updated.id, date: scheduledDateKey(updated.measuredOn) }, { status: 200 });
  }

  const [created] = await db
    .insert(bodyMeasurements)
    .values({ userId: user.id, measuredOn, ...patch })
    .returning();
  return Response.json({ id: created.id, date: scheduledDateKey(created.measuredOn) }, { status: 201 });
});
