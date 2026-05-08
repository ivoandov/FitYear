import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

const ONBOARDED_COOKIE = "fy_onboarded";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const GET = handle(async () => {
  const { user } = await requireUser();
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, user.id))
    .limit(1);
  return (
    row ?? {
      userId: user.id,
      selectedCalendarId: null,
      selectedCalendarName: null,
      weightUnit: "lbs",
      monthlyWorkoutGoal: 16,
      fitbotDefaultFocus: "strength",
      hasCompletedOnboarding: false,
      onboardingDaysPerWeek: null,
      onboardingProgramLength: null,
    }
  );
});

const PatchSchema = z.object({
  selectedCalendarId: z.string().nullable().optional(),
  selectedCalendarName: z.string().nullable().optional(),
  weightUnit: z.enum(["lbs", "kg"]).optional(),
  monthlyWorkoutGoal: z.number().int().min(1).max(31).optional(),
  fitbotDefaultFocus: z.string().optional(),
  hasCompletedOnboarding: z.boolean().optional(),
  onboardingDaysPerWeek: z.number().int().min(1).max(7).nullable().optional(),
  onboardingProgramLength: z.number().int().min(1).max(365).nullable().optional(),
});

export const PATCH = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PatchSchema.parse(await request.json());

  const [existing] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, user.id))
    .limit(1);

  let row;
  if (existing) {
    [row] = await db
      .update(userSettings)
      .set(body)
      .where(eq(userSettings.userId, user.id))
      .returning();
  } else {
    [row] = await db
      .insert(userSettings)
      .values({ userId: user.id, ...body })
      .returning();
  }

  const response = NextResponse.json(row);
  if (typeof body.hasCompletedOnboarding === "boolean") {
    response.cookies.set(ONBOARDED_COOKIE, body.hasCompletedOnboarding ? "1" : "0", {
      path: "/",
      maxAge: COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  }
  return response;
});
