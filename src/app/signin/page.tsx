import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/account");

  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Welcome back (or in!)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-6 text-[15px] text-charcoal/70">
            No passwords here. Tell us your email and we&apos;ll send a one-tap
            sign-in link — it verifies your address at the same time, which
            you&apos;ll need before bidding.
          </p>
          <form
            action={async (formData: FormData) => {
              "use server";
              const email = String(formData.get("email") ?? "")
                .trim()
                .toLowerCase();
              if (!email) return;
              await signIn("resend", { email, redirectTo: "/account" });
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>
            <Button type="submit" variant="cta" className="w-full">
              Email me a sign-in link
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
