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
    return () => {
      root.classList.remove("native");
      delete root.dataset.platform;
    };
  }, []);

  return null;
}
