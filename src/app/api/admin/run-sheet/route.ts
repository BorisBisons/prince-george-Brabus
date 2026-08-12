import { NextResponse } from "next/server";
import { adminIdOrNull } from "@/lib/admin";
import { assignRoute, startRoute, todayInVancouver } from "@/lib/delivery";

export const dynamic = "force-dynamic";

/** Run-sheet controls: recompute route order, or start the route. */
export async function POST(req: Request) {
  const adminId = await adminIdOrNull();
  if (!adminId) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { action } = await req.json().catch(() => ({}));
  const today = todayInVancouver();

  if (action === "reroute") {
    const stops = await assignRoute(today);
    return NextResponse.json({ ok: true, stops });
  }
  if (action === "start") {
    await assignRoute(today);
    const started = await startRoute(adminId, today);
    return NextResponse.json({ ok: true, started });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
