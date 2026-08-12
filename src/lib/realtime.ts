import Pusher from "pusher";

/**
 * Realtime = Pusher Channels (decision in docs/decisions.md): we broadcast a
 * shaped public payload AFTER the bid transaction commits — never raw rows,
 * never before commit. Missing keys degrade gracefully: clients fall back to
 * polling the state endpoint.
 */

let _pusher: Pusher | null | undefined;

function pusherServer(): Pusher | null {
  if (_pusher !== undefined) return _pusher;
  const { PUSHER_APP_ID, PUSHER_SECRET, NEXT_PUBLIC_PUSHER_KEY, NEXT_PUBLIC_PUSHER_CLUSTER } =
    process.env;
  _pusher =
    PUSHER_APP_ID && PUSHER_SECRET && NEXT_PUBLIC_PUSHER_KEY && NEXT_PUBLIC_PUSHER_CLUSTER
      ? new Pusher({
          appId: PUSHER_APP_ID,
          key: NEXT_PUBLIC_PUSHER_KEY,
          secret: PUSHER_SECRET,
          cluster: NEXT_PUBLIC_PUSHER_CLUSTER,
          useTLS: true,
        })
      : null;
  return _pusher;
}

export function auctionChannel(auctionId: string) {
  return `auction-${auctionId}`;
}

/** Fire-and-forget broadcast; realtime is an enhancement, never a dependency. */
export async function broadcastAuction(
  auctionId: string,
  event: "bid" | "status",
  payload: unknown,
): Promise<void> {
  const client = pusherServer();
  if (!client) return;
  try {
    await client.trigger(auctionChannel(auctionId), event, payload);
  } catch (e) {
    console.error(`[realtime] broadcast failed for ${auctionId}:`, e);
  }
}

/** Presence-channel auth (watchers count); any signed-in user may join. */
export function authorizePresence(socketId: string, channel: string, userId: string) {
  const client = pusherServer();
  if (!client) return null;
  return client.authorizeChannel(socketId, channel, {
    user_id: userId,
    user_info: {},
  });
}
