import * as Sentry from "@sentry/nextjs";

// Client init (Next 15.3+/16 instrumentation-client convention). The DSN is
// client-visible by design; it only permits sending events.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});

// Instrument client-side navigations (App Router route transitions).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
