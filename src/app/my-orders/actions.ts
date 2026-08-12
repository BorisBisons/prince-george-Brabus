"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { cancelOrderByWinner, respondToOffer } from "@/lib/payments";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function cancelOrder(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const orderId = String(formData.get("orderId") ?? "");
  await cancelOrderByWinner(orderId, session.user.id);
  revalidatePath("/my-orders");
}

export async function answerOffer(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const orderId = String(formData.get("orderId") ?? "");
  const response = formData.get("response") === "accept" ? "accept" : "decline";
  await respondToOffer(orderId, session.user.id, response);
  revalidatePath("/my-orders");
}

export async function resolveDelivery(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const orderId = String(formData.get("orderId") ?? "");
  const choice = formData.get("choice") === "redelivery" ? "redelivery" : "pickup";
  const { resolveFailedDelivery } = await import("@/lib/delivery");
  await resolveFailedDelivery(orderId, session.user.id, choice);
  revalidatePath("/my-orders");
}
