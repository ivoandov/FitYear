/**
 * The persistent "rest is running" notification.
 *
 * Ivo asked for the rest timer to stay visible when he leaves the app, so he
 * knows when to get back to the bar without reopening FitYear.
 *
 * WHAT THIS CAN AND CANNOT DO. A web app cannot render a live-counting timer in
 * the iOS status bar - that is Live Activities, which needs a native app, and
 * FitYear is a PWA. What it CAN do is post a notification the moment the app is
 * backgrounded, which then sits in the notification shade with the finish TIME
 * on it. The text is therefore written around an absolute clock time ("until
 * 6:42 PM") rather than a countdown, because the text will not re-render while
 * the app is suspended and a frozen "1:30 left" would be a lie within seconds.
 *
 * The end-of-rest alert is separate and already handled by the sleeping Vercel
 * Workflow push. This notification shares its `rest-timer` tag so the finish
 * alert REPLACES the countdown rather than stacking a second one.
 */

export const REST_NOTIFICATION_TAG = "rest-timer";

export interface RestNotificationContent {
  title: string;
  body: string;
}

/** Format an absolute end time the way a phone shows the clock. */
function clockTime(endTimeMs: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(endTimeMs));
  } catch {
    const d = new Date(endTimeMs);
    const h = d.getHours();
    const m = d.getMinutes();
    return `${((h + 11) % 12) + 1}:${m < 10 ? `0${m}` : m}`;
  }
}

/**
 * The shade text for a rest that is currently running.
 *
 * Deliberately states the finish time, not a countdown - see the note above.
 */
export function restOngoingContent(opts: {
  endTimeMs: number;
  exerciseName?: string | null;
  nextExerciseName?: string | null;
}): RestNotificationContent {
  const { endTimeMs, exerciseName, nextExerciseName } = opts;
  const finish = clockTime(endTimeMs);

  const title = `Resting until ${finish}`;

  const after = nextExerciseName?.trim();
  const current = exerciseName?.trim();
  const body = after
    ? `Up next: ${after}`
    : current && current.toLowerCase() !== "rest"
      ? `After ${current}`
      : "Tap when you're back.";

  return { title, body };
}
