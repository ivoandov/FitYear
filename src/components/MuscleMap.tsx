"use client";

import Body from "react-muscle-highlighter";
import type { RegionLoad } from "@/lib/muscle-map";

/**
 * Front and back anatomical figures with the trained regions lit.
 *
 * Drawn client-side by `react-muscle-highlighter` (MIT, pure SVG, no network),
 * chosen over AscendAPI's paid Muscle Visualizer, whose terms forbid keeping
 * the images. Which regions light up, and how brightly, is `lib/muscle-map.ts`.
 *
 * Colors are LITERAL rgba of the brand neon rather than token variables: the
 * package writes them into SVG fill attributes, where var() is not something
 * to rely on in the WKWebView the iOS app runs in. Same pattern this app
 * already uses for neon tints (the summary's personal-bests card). One hue at
 * three strengths - the design system is monochrome neon and has no
 * categorical palette on purpose.
 */
const INTENSITY = ["rgba(229,255,0,0.35)", "rgba(229,255,0,0.65)", "rgba(229,255,0,1)"];
const UNTRAINED = "rgba(255,255,255,0.08)";
const OUTLINE = "rgba(255,255,255,0.16)";

// Parts that are not muscles. The package ships the head and hair with colors
// of their own, and a bright face was the first thing the eye went to.
const NOT_MUSCLES = ["head", "hair", "neck", "hands", "feet", "knees", "ankles"] as const;
const QUIET = NOT_MUSCLES.map((slug) => ({ slug, styles: { fill: UNTRAINED } }));

export function MuscleMap({ loads, testId }: { loads: RegionLoad[]; testId?: string }) {
  const data = [...QUIET, ...loads.map((l) => ({ slug: l.slug, intensity: l.intensity }))];
  return (
    <div
      // The package sizes its SVG at a fixed 200x400 and gives every region a
      // pointer cursor even when nothing is clickable; both are overridden
      // here rather than forked.
      className="mx-auto grid max-w-[320px] grid-cols-2 gap-3 [&_path]:!cursor-default [&_svg]:!h-auto [&_svg]:!w-full"
      role="img"
      aria-label={
        loads.length
          ? `Muscles trained: ${loads.map((l) => l.slug.replace("-", " ")).join(", ")}`
          : "No muscles recorded"
      }
      data-testid={testId}
      data-regions={loads.map((l) => `${l.slug}:${l.intensity}`).join(" ")}
    >
      {(["front", "back"] as const).map((side) => (
        <Body
          key={side}
          data={data}
          side={side}
          colors={INTENSITY}
          defaultFill={UNTRAINED}
          border={OUTLINE}
        />
      ))}
    </div>
  );
}
