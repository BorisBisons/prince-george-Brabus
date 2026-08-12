import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/** Page guard: single admin role (spec §9). */
export async function requireAdmin(): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (session.user.role !== "ADMIN") redirect("/");
  return { id: session.user.id };
}

/** API guard variant — returns null instead of redirecting. */
export async function adminIdOrNull(): Promise<string | null> {
  const session = await auth();
  return session?.user?.role === "ADMIN" ? session.user.id : null;
}
