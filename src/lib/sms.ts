/**
 * Twilio SMS — wired but feature-flagged OFF at launch (ruling #3).
 * The queue layer already gates on SMS_ENABLED; this is the transport.
 */

export function smsConfigured(): boolean {
  return (
    process.env.SMS_ENABLED === "true" &&
    Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER)
  );
}

export async function sendSms(to: string, body: string): Promise<void> {
  if (!smsConfigured()) throw new Error("sms transport not configured");
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER!, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
}
