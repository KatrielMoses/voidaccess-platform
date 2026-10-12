"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@content/auth";
import { authClient } from "@/lib/auth/client";
import { AuthCard, Field, FormError, SubmitButton, TextLink } from "./parts";

const t = auth.reset;

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (params.get("error") || !token) {
    return (
      <AuthCard title={t.invalidTitle} description={t.invalidBody}>
        <TextLink href="/forgot-password">{t.invalidCta}</TextLink>
      </AuthCard>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !token) return;
    const newPassword = String(new FormData(e.currentTarget).get("password") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.resetPassword({ newPassword, token });
      if (res.error) setError(res.error.message ?? t.failed);
      else router.push("/sign-in?notice=reset");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t.title} description={t.description}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field id="password" label={t.label} type="password" autoComplete="new-password" required minLength={10} hint={auth.signUp.passwordHint} />
        <FormError message={error} />
        <SubmitButton busy={busy}>{t.submit}</SubmitButton>
      </form>
    </AuthCard>
  );
}
