import { NextRequest } from "next/server";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { parseTimeZone } from "@/lib/api/timezone";
import { loadTrainingHistory, BASELINE_DAYS } from "@/lib/api/training-history";
import { balanceHeadline } from "@/lib/muscle-balance";

/**
 * What this user has and has not been training lately, per coarse muscle group.
 *
 * The read model behind Home's coaching nudge. The app has always known which
 * muscles were worked and when, and until now never used it to say anything.
 *
 * Counted in SETS, not volume - pounds are not comparable across muscle groups,
 * so a volume ranking reports Biceps as permanently neglected and Legs as
 * permanently fine. Credited ONCE per coarse group per exercise, the same rule
 * the volume charts had to learn: a lunge tagged Quads + Glutes + Hamstrings is
 * one Legs exercise, not three. Identity comes from the per-workout SNAPSHOT,
 * so a later rename cannot rewrite what you did in March.
 *
 * The query itself lives in lib/api/training-history because the AI routes need
 * exactly the same answer and must not disagree with the card that sent the
 * user to them.
 */
export const GET = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const tz = parseTimeZone(request.nextUrl.searchParams.get("tz"));
  const history = await loadTrainingHistory(user.id, tz);
  return Response.json({
    baselineDays: BASELINE_DAYS,
    totalWorkouts: history.totalWorkouts,
    headline: balanceHeadline(history.verdicts),
    groups: history.verdicts,
  });
});
