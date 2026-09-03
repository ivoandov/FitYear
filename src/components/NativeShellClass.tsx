"use client";

import { useEffect } from "react";
import { isNative, platformName } from "@/lib/native";

/**
 * Marks the document as running inside the native shell.
 *
 * Renders nothing. Chrome differences between the app and the website are
 * expressed in CSS against `html.native` rather than branching in each
 * component: the top safe area is the only real difference, and scattering
 * `isNative()` through the layout would be far easier to get subtly wrong.
 *
 * Applied in an effect rather than during render because the server has no idea
 * which shell is asking, and a mismatch would be a hydration error.
 */
export function NativeShellClass() {
  useEffect(() => {
    if (!isNative()) return;
    const root = document.documentElement;
    root.classList.add("native");
    root.dataset.platform = platformName();

    // Hide the splash once React has actually mounted.
    //
    // The shell sets launchAutoHide: false SO THAT the splash covers the
    // initial network load of the remote site instead of flashing a blank
    // WebView. The other half of that bargain is this call - without it the
    // splash never goes away and the app is a permanently frozen logo, which
    // is exactly what the first simulator run showed.
    void (async () => {
      try {
        const { SplashScreen } = await import("@capacitor/splash-screen");
        await SplashScreen.hide();
      } catch {
        // Plugin missing: better a visible app than a stuck splash.
      }
    })();

    // Light text on the dark app, drawn under the status bar.
    void (async () => {
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setOverlaysWebView({ overlay: true });
      } catch {
        /* ignore */
      }
    })();

    return () => {
      root.classList.remove("native");
      delete root.dataset.platform;
    };
  }, []);

  return null;
}
