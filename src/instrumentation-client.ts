import * as Sentry from "@sentry/nextjs";
import { platformName } from "@/lib/native";

// Client init (Next 15.3+/16 instrumentation-client convention). The DSN is
// client-visible by design; it only permits sending events.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});

// Which shell reported this: "ios" for the native app, "web" for the site.
// Without it every native crash is indistinguishable from a Safari one, and the
// two have genuinely different failure modes (WebView storage eviction, plugin
// availability, the status-bar overlay).
Sentry.setTag("shell", platformName());

// Instrument client-side navigations (App Router route transitions).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
