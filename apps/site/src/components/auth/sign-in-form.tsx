"use client";

import { useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { auth } from "@content/auth";
import { authClient } from "@/lib/auth/client";
import { APP_URL, CAPTCHA_HEADER } from "@/lib/auth/config";
import { safeNext } from "@/lib/auth/safe-next";
import { GithubButton, OrDivider } from "./github-button";
import { AuthCard, Field, FormError, FormNotice, SecondaryButton, SubmitButton, TextLink } from "./parts";
import { Turnstile } from "./turnstile";

type Mode = "password" | "magic";
const t = auth.signIn;

export function SignInForm() {
  const params = useSearchParams();
  const target = safeNext(params.get("next"), APP_URL);
  const [mode, setMode] = useState<Mode>("password");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(params.get("error") ? t.oauthFailed : null);
  const [notice, setNotice] = useState<string | null>(params.get("notice") === "reset" ? t.resetDone : null);
  const resetCaptcha = useRef<() => void>(() => {});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "magic") {
        if (!token) return setError(t.captcha);
        const res = await authClient.signIn.magicLink({ email, callbackURL: target }, { headers: { [CAPTCHA_HEADER]: token } });
        if (res.error) setError(res.error.message ?? t.magicFailed);
        else setNotice(t.magicSent);
        resetCaptcha.current();
        return;
      }
      const res = await authClient.signIn.email({ email, password: String(fd.get("password") ?? ""), callbackURL: target });
      if (res.error) {
        setError(res.error.status === 403 ? t.unverified : (res.error.message ?? t.failed));
        return;
      }
      window.location.assign(target);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t.title} description={t.description}>
      <GithubButton callbackURL={target} />
      <OrDivider />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field id="email" label={auth.email} type="email" autoComplete="email" required />
        {mode === "password" ? (
          <div className="flex flex-col gap-1.5">
            <Field id="password" label={auth.password} type="password" autoComplete="current-password" required />
            <TextLink href="/forgot-password" className="self-end !text-xs">
              {t.forgot}
            </TextLink>
          </div>
        ) : (
          <Turnstile onToken={setToken} resetRef={resetCaptcha} />
        )}
        <FormError message={error} />
        <FormNotice message={notice} />
        <SubmitButton busy={busy} disabled={mode === "magic" && !token}>
          {mode === "password" ? t.submit : t.submitMagic}
        </SubmitButton>
      </form>
      <SecondaryButton
        onClick={() => {
          setMode(mode === "password" ? "magic" : "password");
          setError(null);
          setNotice(null);
          setToken("");
        }}
      >
        {mode === "password" ? t.useMagic : t.usePassword}
      </SecondaryButton>
      <p className="text-center text-sm text-fg-secondary">
        {t.noAccount} <TextLink href="/sign-up">{t.createAccount}</TextLink>
      </p>
    </AuthCard>
  );
}
