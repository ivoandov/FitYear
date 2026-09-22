/**
 * When a running program is over.
 *
 * Nothing in this app ever retired one. `status` has held "completed" as a
 * legal value since the beginning and no code path ever wrote it, so a program
 * left "active" forever: Home and the Routines card kept presenting a finished
 * block as the current one, FitBot's `get_active_program` reasoned about a plan
 * whose last day was weeks past, and restarting that same routine answered 409
 * "This routine is already running" off the partial unique index. The tracker
 * even congratulated the user with a "Routine complete" toast while the row
 * stayed active, which is the giveaway: the app knew, and wrote nothing down.
 *
 * Two different endings, because programs end in two different ways.
 */

/** The counters a routine instance keeps. All three are hand-maintained. */
export type InstanceProgress = {
  completedWorkouts: number | null;
  skippedWorkouts: number | null;
  totalWorkouts: number | null;
};

/**
 * Every planned session is accounted for: done or deliberately skipped.
 *
 * Skips count because a skip is a decision about that session, not a debt. A
 * program whose last session is skipped is over, and requiring the count to be
 * reached by completions alone would leave it active with nothing left to do.
 *
 * `totalWorkouts` is the denominator of every progress readout and is decremented
 * when a routine edit drops sessions, so this reads whatever it says now rather
 * than recomputing a plan.
 */
export function hasRunItsCourse(p: InstanceProgress): boolean {
  const total = p.totalWorkouts ?? 0;
  if (total <= 0) return false;
  return (p.completedWorkouts ?? 0) + (p.skippedWorkouts ?? 0) >= total;
}

/**
 * The other ending, and the common one: the user simply stopped. The last
 * planned day is in the past and nothing is on the calendar, so no future
 * session can arrive to change the count.
 *
 * Both dates are AUTHORED DAYS compared as "YYYY-MM-DD" keys, never instants -
 * `end_date` is a day somebody chose and the comparison must not be shiftable
 * by a timezone or a DST boundary. Strictly past, so a program ending today is
 * still today's program.
 */
export function hasRunOutOfDays(args: {
  endDateKey: string | null;
  todayKey: string;
  upcomingSessions: number;
}): boolean {
  if (args.upcomingSessions > 0) return false;
  if (!args.endDateKey) return false;
  return args.endDateKey < args.todayKey;
}
