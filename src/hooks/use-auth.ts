"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { clearLocalUserData } from "@/lib/session-cleanup";

// Tracks the last signed-in user id on this device so we can detect an account
// switch (a different user logging in without a clean logout first) and purge
// the previous user's cached data before it paints.
const LAST_UID_KEY = "fy_last_uid";

export interface ProfileUser {
  id: string;
  email: string | null | undefined;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

function fromSupabase(u: User | null): ProfileUser | null {
  if (!u) return null;
  const m = u.user_metadata as Record<string, unknown> | null;
  const first = (m?.first_name as string | undefined) ?? (m?.full_name as string | undefined)?.split(" ")[0] ?? null;
  const last = (m?.last_name as string | undefined) ?? (m?.full_name as string | undefined)?.split(" ").slice(1).join(" ") ?? null;
  return {
    id: u.id,
    email: u.email,
    firstName: first,
    lastName: last,
    profileImageUrl: (m?.avatar_url as string | undefined) ?? (m?.profile_image_url as string | undefined) ?? null,
  };
}

export function useAuth() {
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(fromSupabase(user));
      setIsLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Belt-and-suspenders privacy purge (complements the explicit logout()
      // path below). Catches sessions that ended without a clean logout —
      // crash, cookie expiry, or an OAuth account switch on a shared device.
      try {
        if (event === "SIGNED_OUT") {
          clearLocalUserData();
        } else if (session?.user) {
          const prevUid = localStorage.getItem(LAST_UID_KEY);
          if (prevUid && prevUid !== session.user.id) {
            // A different account than last time — wipe the previous user's
            // cached data before this render paints it.
            clearLocalUserData();
          }
          localStorage.setItem(LAST_UID_KEY, session.user.id);
        }
      } catch {
        // localStorage can throw in private mode — never block auth state on it
      }
      setUser(fromSupabase(session?.user ?? null));
    });
    return () => subscription.unsubscribe();
  }, []);

  function logout() {
    setIsLoggingOut(true);
    // Purge locally-cached user data BEFORE navigating away so nothing survives
    // for the next user on a shared device. queryClient.clear() + removing the
    // persisted cache + the other app-owned localStorage keys (theme kept).
    clearLocalUserData();
    // POST to /auth/signout — proxy then takes care of redirect
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/auth/signout";
    document.body.appendChild(form);
    form.submit();
  }

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout,
    isLoggingOut,
  };
}
