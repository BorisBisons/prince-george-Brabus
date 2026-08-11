/**
 * Resend transport + the one branded email shell. Every email carries the
 * CASL one-click unsubscribe: List-Unsubscribe headers AND a visible footer
 * link, keyed by the recipient's stable token.
 */

export interface EmailInput {
  to: string;
  subject: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  unsubscribeUrl?: string;
  imageUrl?: string;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(input: EmailInput): Promise<void> {
  if (!emailConfigured()) throw new Error("email transport not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: renderEmail(input),
      text: `${input.heading}\n\n${input.body}\n\n${input.ctaLabel}: ${input.ctaUrl}${
        input.unsubscribeUrl ? `\n\nUnsubscribe: ${input.unsubscribeUrl}` : ""
      }`,
      ...(input.unsubscribeUrl
        ? {
            headers: {
              "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

function renderEmail(i: EmailInput): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#FAF7F2;color:#2B2B2B;">
    <div style="max-width:520px;margin:0 auto;padding:40px 20px;">
      <p style="font-family:Georgia,serif;font-size:22px;color:#C9A96A;text-align:center;margin:0 0 24px;letter-spacing:0.5px;">BloomBid</p>
      <div style="background:#FFFFFF;border-radius:16px;padding:36px 32px;box-shadow:0 2px 16px rgba(30,58,47,0.08);">
        ${i.imageUrl ? `<img src="${i.imageUrl}" alt="" style="width:100%;border-radius:12px;margin-bottom:24px;" />` : ""}
        <h1 style="font-family:Georgia,serif;font-size:26px;color:#1E3A2F;margin:0 0 12px;line-height:1.25;">${i.heading}</h1>
        <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#2B2B2B;margin:0 0 28px;">${i.body}</p>
        <a href="${i.ctaUrl}"
           style="display:inline-block;background:#D8A7B1;color:#2B2B2B;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;padding:13px 28px;border-radius:16px;">
          ${i.ctaLabel}
        </a>
      </div>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#8a8a8a;text-align:center;margin-top:24px;line-height:1.7;">
        BloomBid · Prince George, BC · one drop a day
        ${i.unsubscribeUrl ? `<br/><a href="${i.unsubscribeUrl}" style="color:#8a8a8a;">Unsubscribe from these emails</a>` : ""}
      </p>
    </div>
  </body>
</html>`;
}
