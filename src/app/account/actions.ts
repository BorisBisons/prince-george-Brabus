"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import * as cards from "@/lib/payment-methods";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return session.user.id;
}

const profileSchema = z.object({
  name: z.string().trim().max(80),
  phone: z
    .string()
    .trim()
    .regex(/^(\+1\d{10})?$/, "Use +1 followed by 10 digits, or leave blank"),
});

export async function updateProfile(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const parsed = profileSchema.safeParse({
    name: formData.get("name") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) return; // client input attrs mirror the schema; silently ignore tampering

  await prisma.user.update({
    where: { id: userId },
    data: { name: parsed.data.name || null, phone: parsed.data.phone || null },
  });
  revalidatePath("/account");
}

export async function makeCardDefault(formData: FormData) {
  const userId = await requireUserId();
  const id = String(formData.get("paymentMethodId") ?? "");
  await cards.setDefaultCard(userId, id);
  revalidatePath("/account");
}

export async function deleteCard(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("paymentMethodId") ?? "");
  await cards.removeCard(userId, id); // blocked-removal reason surfaces via page state
  revalidatePath("/account");
}
