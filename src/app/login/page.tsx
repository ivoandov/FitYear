import Image from "next/image";
import { LoginButton } from "./LoginButton";

// Server component — emits the video + logo shell in the SSR HTML so the
// browser starts fetching assets before client JS hydrates. Only the
// auth button is client (signInWithGoogle + busy/error state).
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ next?: string | string[] }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const rawNext = sp.next;
  const next =
    typeof rawNext === "string"
      ? rawNext
      : Array.isArray(rawNext) && rawNext[0]
        ? rawNext[0]
        : "/";

  return (
    <div className="fixed inset-0 w-full h-full overflow-hidden">
      {/* Full-bleed intro video. autoPlay+muted is required for iOS Safari to
          play inline without a tap. playsInline avoids fullscreening on mobile.
          poster = first paint (25 KB JPG) while the 1.4 MB MP4 streams in.
          preload="auto" hints the browser to start downloading immediately.
          The MP4 is faststart-encoded so the moov atom is at the head —
          playback begins after the first ~17 KB instead of needing the full
          file. */}
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        poster="/fityear-intro.jpg"
        className="absolute inset-0 w-full h-full object-cover"
        data-testid="video-background"
      >
        <source src="/fityear-intro.mp4" type="video/mp4" />
      </video>

      {/* Darken so the logo + button read against bright frames in the video */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Bottom-anchored content: logo + Google CTA */}
      <div className="relative z-10 flex flex-col items-center justify-end h-full pb-16 px-6">
        <Image
          src="/fityear-logo.png"
          alt="FitYear"
          width={320}
          height={120}
          priority
          className="w-64 sm:w-80 h-auto mb-8"
          data-testid="img-logo"
        />

        <LoginButton next={next} />

        <p className="mt-3 max-w-sm text-center text-xs text-white/70 drop-shadow">
          Sign in with the Google account you used before. All your workouts and
          history will be there.
        </p>
      </div>
    </div>
  );
}
