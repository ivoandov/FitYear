import type { CapacitorConfig } from "@capacitor/cli";

/**
 * FitYear iOS shell.
 *
 * Loads the LIVE site rather than bundling a copy. The web app cannot be
 * statically exported - 52 API routes, server components and a cookie auth gate
 * in proxy.ts - and a rewrite of 15 pages and 30k lines is not a build session.
 * What makes this an app rather than a bookmark is the native capability set:
 * sign-in, APNs push, haptics, keep-awake, the share sheet and safe-area chrome,
 * all of which are already live in the web app behind isNative().
 */
const config: CapacitorConfig = {
  appId: "ai.flyhi.fityear",
  appName: "FitYear",
  // Holds only the offline page. The app itself is served from server.url.
  webDir: "www",

  server: {
    url: "https://fityear.flyhi.ai",
    // Deliberately empty: every OTHER host opens in the system browser, which
    // is exactly what we want for Google's consent screen (it refuses to run
    // inside a WKWebView) and for any outbound link.
    allowNavigation: [],
    // A remote-URL WebView with no network is a white screen, which App Review
    // treats as a defect. This is the local page shown instead.
    errorPath: "offline.html",
  },

  ios: {
    // The WebView must not add its own inset on top of the safe-area padding
    // the site already applies under html.native.
    contentInset: "never",
    // Pairs with WKAppBoundDomains in Info.plist. App-bound domains are exempt
    // from ITP's 7-day eviction of script-written storage, which otherwise logs
    // the user out and wipes the local workout backup after a week idle.
    limitsNavigationsToAppBoundDomains: true,
    // Lets the server and Sentry tell the app apart from Safari.
    appendUserAgent: "FitYearNative/1.0",
    allowsLinkPreview: false,
  },

  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "banner", "list"],
    },
    SplashScreen: {
      // Auto-hides on a timer, and the web app ALSO calls hide() as soon as it
      // mounts (whichever comes first wins).
      //
      // launchAutoHide:false was wrong here and shipped a permanently frozen
      // logo: this app's JS comes from the NETWORK, so making the splash depend
      // on it means a slow or failed load leaves the splash up forever - it
      // would even cover the offline page, which is the one screen that exists
      // for exactly that situation. A timer cannot get stuck.
      launchAutoHide: true,
      launchShowDuration: 3000,
      backgroundColor: "#0B0B0A",
      showSpinner: false,
    },
    // CapacitorCookies and CapacitorHttp are deliberately NOT enabled: both
    // override WebKit's own cookie and fetch handling and both have open
    // persistence bugs. WKWebView's native cookie store plus app-bound domains
    // is the reliable path for the Supabase session.
  },
};

export default config;
