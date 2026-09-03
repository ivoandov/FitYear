"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";
import { signInNatively, type NativeProvider } from "@/lib/native-auth";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginButton({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resolved in an effect, not during render: the server cannot know which
  // shell is asking, so branching at render time would be a hydration mismatch.
  const [native, setNative] = useState(false);
  useEffect(() => setNative(isNative()), []);

  async function signInNative(provider: NativeProvider) {
    setBusy(true);
    setError(null);
    const result = await signInNatively(provider);
    if (result.ok) {
      // Full navigation rather than a router push: the session cookies were
      // just written client-side and the proxy must re-evaluate them, which is
      // also the house rule after any Supabase write.
      window.location.href = next || "/";
      return;
    }
    setBusy(false);
    if (result.reason === "cancelled") return; // they closed the sheet; not an error
    setError(
      result.reason === "unavailable"
        ? "Sign-in is unavailable in this build."
        : (result.message ?? "Sign-in failed. Please try again."),
    );
  }

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  // In the native shell Google's OAuth REDIRECT is impossible - it returns
  // disallowed_useragent inside a WKWebView - so both providers go through the
  // id-token flow instead. Apple is listed first and styled as the primary
  // action, which its Human Interface Guidelines require wherever Sign in with
  // Apple is offered alongside other providers.
  if (native) {
    return (
      <>
        <button
          type="button"
          onClick={() => signInNative("apple")}
          disabled={busy}
          className="inline-flex h-12 w-full max-w-sm items-center justify-center gap-3 rounded-lg bg-white px-5 font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          data-testid="button-login-apple"
        >
          <AppleIcon />
          {busy ? "Signing in…" : "Sign in with Apple"}
        </button>

        <button
          type="button"
          onClick={() => signInNative("google")}
          disabled={busy}
          className="mt-3 inline-flex h-12 w-full max-w-sm items-center justify-center gap-3 rounded-lg border border-strong bg-white/[0.06] px-5 font-bold text-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          data-testid="button-login-google-native"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <p className="mt-4 max-w-sm text-center text-[12px] leading-snug text-white/70 drop-shadow">
          Use the same method you signed up with. Signing in with Apple and
          hiding your email creates a separate account.
        </p>

        {error ? (
          <p className="mt-3 max-w-sm text-center text-sm text-white drop-shadow">{error}</p>
        ) : null}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy}
        className="inline-flex h-12 w-full max-w-sm items-center justify-center gap-3 rounded-lg bg-primary px-5 font-bold text-primary-foreground shadow-cta transition-opacity hover:opacity-90 disabled:opacity-50"
        data-testid="button-login"
      >
        <GoogleIcon />
        {busy ? "Connecting…" : "Continue with Google"}
      </button>

      {error ? (
        <p className="mt-3 max-w-sm text-center text-sm text-white drop-shadow">
          {error}
        </p>
      ) : null}
    </>
  );
}

function GoogleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="20" viewBox="0 0 814 1000" fill="currentColor" aria-hidden>
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zM554.1 159.4c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}
