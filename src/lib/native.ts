import { Capacitor } from "@capacitor/core";

/**
 * True only inside the iOS (or Android) shell, false in every browser.
 *
 * Every native branch in this codebase is gated on this. The web app is the
 * same deployment for Safari users and for the native shell - the shell loads
 * https://fityear.flyhi.ai rather than bundling a copy - so an ungated native
 * call would break the site for everyone.
 *
 * `@capacitor/core` is a dependency of the WEB app on purpose: it is tiny, and
 * on the web every plugin resolves to a no-op web implementation, so importing
 * it costs nothing and keeps the branches in one readable place.
 */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    // Defensive: if the bridge is missing entirely, this is not native.
    return false;
  }
}

/** "ios" | "android" | "web". Useful for telling Sentry which shell reported a crash. */
export function platformName(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return "web";
  }
}
