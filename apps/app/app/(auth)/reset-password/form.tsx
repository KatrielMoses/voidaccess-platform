"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@voidaccess/ui";
import { authClient } from "@/lib/auth/client";
import { AuthCard } from "@/components/auth-card";
import { Field, FormError } from "@/components/field";

export function ResetForm({ token, invalid }: { token: string | null; invalid: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (invalid || !token) {
    return (
      <AuthCard title="Link expired" description="This reset link is invalid or has already been used.">
        <Link href="/forgot-password" className="text-accent underline underline-offset-2">
          Request a new link
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" description="This signs you out everywhere else.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const newPassword = String(new FormData(e.currentTarget).get("password") ?? "");
          setBusy(true);
          setError(null);
          const res = await authClient.resetPassword({ newPassword, token });
          setBusy(false);
          if (res.error) setError(res.error.message ?? "Could not reset the password");
          else router.push("/sign-in");
        }}
      >
        <Field
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          hint="At least 10 characters."
        />
        <FormError message={error} />
        <Button type="submit" loading={busy} size="lg" className="w-full">
          Set password
        </Button>
      </form>
    </AuthCard>
  );
}
