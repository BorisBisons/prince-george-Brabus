import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

/**
 * Passwordless magic-link auth. Signing in via the emailed link is what
 * verifies the address (Auth.js sets `emailVerified`), which is one of the
 * three bidding requirements: account + verified email + valid saved card.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  pages: {
    signIn: "/signin",
    verifyRequest: "/check-your-email",
  },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM,
      async sendVerificationRequest({ identifier, url, provider }) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: provider.from,
            to: identifier,
            subject: "Your BloomBid sign-in link 🌸",
            html: magicLinkEmail(url),
            text: `Sign in to BloomBid: ${url}\n\nThis link expires in 24 hours. If you didn't ask for it, you can ignore this email.`,
          }),
        });
        if (!res.ok) {
          throw new Error(`Resend error: ${res.status} ${await res.text()}`);
        }
      },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      session.user.role = (user as unknown as { role: "BUYER" | "ADMIN" }).role;
      return session;
    },
  },
});

function magicLinkEmail(url: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#FAF7F2;font-family:Georgia,serif;color:#2B2B2B;">
    <div style="max-width:480px;margin:0 auto;padding:48px 24px;">
      <div style="background:#1E3A2F;border-radius:16px;padding:40px 32px;text-align:center;">
        <p style="font-size:28px;margin:0 0 8px;color:#C9A96A;letter-spacing:0.5px;">BloomBid</p>
        <p style="color:#FAF7F2;font-size:16px;margin:0 0 28px;">One tap and you're in.</p>
        <a href="${url}"
           style="display:inline-block;background:#D8A7B1;color:#2B2B2B;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;padding:14px 32px;border-radius:16px;">
          Sign in to BloomBid
        </a>
      </div>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#6b6b6b;text-align:center;margin-top:24px;line-height:1.6;">
        This link expires in 24 hours and can be used once.<br/>
        Didn't ask for it? No worries — just ignore this email.
      </p>
    </div>
  </body>
</html>`;
}
