"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@voidaccess/ui";
import { authClient } from "@/lib/auth/client";
import { AuthCard } from "@/components/auth-card";
import { Field, FormError, FormNotice } from "@/components/field";

export default function ForgotPasswordPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  return (
    <AuthCard title="Reset your password" description="Enter your email and we'll send a reset link.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const email = String(new FormData(e.currentTarget).get("email") ?? "");
          setBusy(true);
          setError(null);
          const res = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
          setBusy(false);
          if (res.error && res.error.status !== 404) setError(res.error.message ?? "Could not send the link");
          else setSent(true);
        }}
      >
        <Field id="email" label="Email" type="email" autoComplete="email" required />
        <FormError message={error} />
        {sent ? (
          <FormNotice message="If an account exists for that address, a reset link is on its way." />
        ) : null}
        <Button type="submit" loading={busy} size="lg" className="w-full">
          Send reset link
        </Button>
        <Link href="/sign-in" className="text-center text-sm text-accent underline underline-offset-2">
          Back to sign in
        </Link>
      </form>
    </AuthCard>
  );
}
