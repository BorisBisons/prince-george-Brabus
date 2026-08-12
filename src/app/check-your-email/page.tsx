export const metadata = { title: "Check your email" };

export default function CheckYourEmailPage() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="font-display text-4xl text-forest">The link is in the mail. 💌</p>
      <p className="mt-4 text-charcoal/70">
        We just sent a sign-in link to your inbox. It&apos;s good for 24 hours —
        tap it and you&apos;re in. (Nothing there? Give the spam folder a peek.)
      </p>
    </div>
  );
}
