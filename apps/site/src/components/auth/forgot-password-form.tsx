"use client";

import { useRef, useState, type FormEvent } from "react";
import { auth } from "@content/auth";
import { authClient } from "@/lib/auth/client";
import { CAPTCHA_HEADER } from "@/lib/auth/config";
import { AuthCard, Field, FormError, FormNotice, SubmitButton, TextLink } from "./parts";
import { Turnstile } from "./turnstile";

const t = auth.forgot;

export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const resetCaptcha = useRef<() => void>(() => {});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !token) return;
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.requestPasswordReset(
        { email, redirectTo: `${window.location.origin}/reset-password` },
        { headers: { [CAPTCHA_HEADER]: token } },
      );
      // Neutral on purpose: never reveal whether the address has an account.
      if (res.error && res.error.status !== 404 && res.error.status !== 400) setError(res.error.message ?? t.failed);
      else setSent(true);
      resetCaptcha.current();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t.title} description={t.description}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field id="email" label={auth.email} type="email" autoComplete="email" required />
        <Turnstile onToken={setToken} resetRef={resetCaptcha} />
        <FormError message={error} />
        <FormNotice message={sent ? t.notice : null} />
        <SubmitButton busy={busy} disabled={!token}>
          {t.submit}
        </SubmitButton>
        <TextLink href="/sign-in" className="text-center">
          {t.back}
        </TextLink>
      </form>
    </AuthCard>
  );
}
