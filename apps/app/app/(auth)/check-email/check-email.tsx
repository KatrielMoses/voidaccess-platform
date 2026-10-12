"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@voidaccess/ui";
import { authClient } from "@/lib/auth/client";
import { AuthCard } from "@/components/auth-card";
import { FormError, FormNotice } from "@/components/field";

export function CheckEmail({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <AuthCard
      title="Check your email"
      description={
        email
          ? `We sent a confirmation link to ${email}. Open it to finish creating your account.`
          : "We sent you a confirmation link. Open it to finish creating your account."
      }
    >
      <p className="text-sm text-fg-secondary">
        You can only start an investigation after your email is confirmed.
      </p>
      {msg?.ok ? <FormNotice message={msg.text} /> : <FormError message={msg?.text} />}
      {email ? (
        <Button
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const res = await authClient.sendVerificationEmail({ email, callbackURL: "/welcome" });
            setBusy(false);
            setMsg(
              res.error
                ? { ok: false, text: res.error.message ?? "Could not resend" }
                : { ok: true, text: "Sent again." },
            );
          }}
        >
          Resend the email
        </Button>
      ) : null}
      <Link href="/sign-in" className="text-sm text-accent underline underline-offset-2">
        Back to sign in
      </Link>
    </AuthCard>
  );
}
