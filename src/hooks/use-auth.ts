"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(fromSupabase(session?.user ?? null));
    });
    return () => subscription.unsubscribe();
  }, []);

  function logout() {
    setIsLoggingOut(true);
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
