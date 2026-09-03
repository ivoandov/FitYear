import { registerPlugin } from "@capacitor/core";
import { isNative } from "@/lib/native";

/**
 * The lock-screen rest timer (iOS Live Activity).
 *
 * Shaped exactly like `native-feedback.ts`: every function is a NO-OP on the
 * web and never throws, so `TimerContext` calls them unconditionally and grows
 * no `isNative()` branch of its own. A failure here must never be able to
 * disturb the countdown on screen, which is the real timer.
 *
 * Why this is the feature that answers "your app is just a website": a
 * suspended web page cannot re-render, so the web version's shade notification
 * can only ever state a fixed finish TIME ("Resting until 6:42"). ActivityKit
 * renders a live countdown on a locked phone with the app suspended. The web
 * app physically cannot do it.
 *
 * There is no activity id in this API on purpose. There is only ever one rest,
 * and the native side finds it through `Activity.activities` - a Live Activity
 * outlives the process that started it, so an id held in JS would be lost
 * exactly when a stale countdown most needs clearing.
 */

interface RestLiveActivityPlugin {
  isSupported(): Promise<{ supported: boolean; reason?: string }>;
  start(options: {
    endTime: number;
    exerciseName: string;
    nextExerciseName?: string;
  }): Promise<{ started: boolean }>;
  end(): Promise<void>;
}

// Registered natively by MainViewController (it is app-local, not an npm
// plugin, so it is absent from capacitor.config.json's packageClassList). On
// the web this proxy exists but every call rejects, which is why isNative()
// gates them below.
const RestLiveActivity = registerPlugin<RestLiveActivityPlugin>("RestLiveActivity");

/**
 * Show the rest on the lock screen, counting down to `endTime`.
 *
 * Safe to call on an already-running activity: the native side updates it in
 * place rather than restarting, so extending a rest (+30s, "rest again") slides
 * the countdown rather than making the card vanish and reappear.
 *
 * @param endTime absolute epoch ms, the same instant the on-screen timer targets
 */
export async function startRestActivity(opts: {
  endTime: number;
  exerciseName: string;
  nextExerciseName?: string;
}): Promise<void> {
  if (!isNative()) return;
  try {
    await RestLiveActivity.start({
      endTime: opts.endTime,
      exerciseName: opts.exerciseName || "Rest",
      // The bridge drops undefined; an empty string is what the widget checks.
      nextExerciseName: opts.nextExerciseName ?? "",
    });
  } catch {
    // Live Activities turned off in Settings, the per-app limit, an older iOS.
    // None of them are worth telling the user about mid-set.
  }
}

/** Take the card off the lock screen. Idempotent, and safe when none exists. */
export async function endRestActivity(): Promise<void> {
  if (!isNative()) return;
  try {
    await RestLiveActivity.end();
  } catch {
    /* ignore */
  }
}
