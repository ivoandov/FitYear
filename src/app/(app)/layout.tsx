import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

  return (
    <Providers>
      <div className="flex min-h-screen w-full flex-col">
        <AppHeader />
        <main className="flex flex-1 flex-col overflow-auto pb-20">
          {children}
        </main>
        <BottomNav />
        <FloatingTimerPill />
      </div>
    </Providers>
  );
}
