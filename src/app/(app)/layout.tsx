import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { Providers } from "@/components/Providers";
import { BottomNav } from "@/components/BottomNav";
import { FloatingTimerPill } from "@/components/FloatingTimerPill";
import { AppHeader } from "@/components/AppHeader";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // First-launch onboarding gate: if hasCompletedOnboarding is false (or there's
  // no user_settings row yet), redirect to /onboarding — except when the user
  // is already on /onboarding itself.
  const pathname = (await headers()).get("x-pathname") ?? "/";
  if (pathname !== "/onboarding") {
    const [settings] = await db
      .select({ done: userSettings.hasCompletedOnboarding })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);
    if (!settings?.done) {
      redirect("/onboarding");
    }
  }

  // Onboarding gets a stripped-down chrome (no header / nav)
  const isOnboarding = pathname === "/onboarding";

  return (
    <Providers>
      <div className="flex min-h-screen w-full flex-col">
        {isOnboarding ? null : <AppHeader />}
        <main className={`flex flex-1 flex-col ${isOnboarding ? "" : "overflow-auto pb-20"}`}>
          {children}
        </main>
        {isOnboarding ? null : <BottomNav />}
        {isOnboarding ? null : <FloatingTimerPill />}
      </div>
    </Providers>
  );
}
