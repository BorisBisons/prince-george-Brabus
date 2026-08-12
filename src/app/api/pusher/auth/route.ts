import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authorizePresence } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/** Presence-channel auth: watcher counts on auction pages / admin live view. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const form = await req.formData();
  const socketId = String(form.get("socket_id") ?? "");
  const channel = String(form.get("channel_name") ?? "");
  if (!socketId || !channel.startsWith("presence-auction-")) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const authResponse = authorizePresence(socketId, channel, session.user.id);
  if (!authResponse) return NextResponse.json({ error: "Realtime not configured" }, { status: 503 });
  return NextResponse.json(authResponse);
}
