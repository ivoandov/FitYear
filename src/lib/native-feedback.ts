import { isNative } from "@/lib/native";

/**
 * Physical feedback, and keeping the screen alive during a workout.
 *
 * Every function here is a NO-OP on the web and never throws, so call sites do
 * not need their own guards - the point is that `track/page.tsx` should not
 * grow an `isNative()` branch around each buzz.
 *
 * `navigator.vibrate` stays where it already is: it works on Android and
 * desktop Chrome and is simply absent on iOS Safari, so the two are
 * complementary rather than alternatives.
 */

type ImpactWeight = "light" | "medium" | "heavy";

/** A tap. Used when a set is completed. */
export async function hapticImpact(style: ImpactWeight = "medium"): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    const map = {
      light: ImpactStyle.Light,
      medium: ImpactStyle.Medium,
      heavy: ImpactStyle.Heavy,
    } as const;
    await Haptics.impact({ style: map[style] });
  } catch {
    // A missing plugin must never break logging a set.
  }
}

/** The distinct triple-tap iOS uses for "something good happened". For a PR. */
export async function hapticSuccess(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    /* ignore */
  }
}

/** Rest is over. Deliberately heavier than a set completion. */
export async function hapticRestComplete(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Warning });
  } catch {
    /* ignore */
  }
}

/**
 * Hold the screen awake while a workout is in progress.
 *
 * The single most-requested thing about any web-based tracker: the phone dims
 * mid-set and you have to wake it with chalky hands. A website cannot do this
 * on iOS at all, so it is also one of the clearest "this is an app, not a
 * bookmark" differences for App Review.
 */
export async function keepScreenAwake(on: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    const { KeepAwake } = await import("@capacitor-community/keep-awake");
    if (on) await KeepAwake.keepAwake();
    else await KeepAwake.allowSleep();
  } catch {
    /* ignore */
  }
}
