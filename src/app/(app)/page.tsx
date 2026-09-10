import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { loadHomePayload } from "@/lib/api/home-payload";
import HomeClient from "./HomeClient";

export default async function HomePage() {
  const user = await getServerUser();
  if (!user) redirect("/login");
  const initial = await loadHomePayload(user.id);
  return <HomeClient initial={initial} />;
}
