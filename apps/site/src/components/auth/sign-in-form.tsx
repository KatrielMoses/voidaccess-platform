"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { auth } from "@content/auth";
import { getConsent, getFirstTouch } from "@/lib/analytics";
import { authClient } from "@/lib/auth/client";
import { APP_URL, CAPTCHA_HEADER } from "@/lib/auth/config";
import { firstTouchPayload } from "@/lib/auth/first-touch";
import { safeNext } from "@/lib/auth/safe-next";
import { AuthCard, Field, FormError, FormNotice, SecondaryButton, SubmitButton, TextLink } from "./parts";
import { OrDivider, ProviderButtons } from "./provider-buttons";
import { Turnstile } from "./turnstile";

const t = auth.signIn;
const RESEND_COOLDOWN_S = 30;

/**
 * One page for everyone: Google, Microsoft, GitHub, or a 6-digit code by email. The first sign-in creates the
 * account; afterwards the same steps simply sign the user back in.
 */
export function SignInForm() {
  const params = useSearchParams();
  const target = safeNext(params.get("next"), APP_URL);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(params.get("error") ? t.oauthFailed : null);
  const [notice, setNotice] = useState<string | null>(null);
  const resetCaptcha = useRef<() => void>(() => {});

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function sendCode(address: string): Promise<boolean> {
    if (!token) {
      setError(t.captcha);
      return false;
    }
    // firstTouch here only attributes the `signup_started` event; the sign-in step stores it on a new account.
    const res = await authClient.emailOtp.sendVerificationOtp(
      { email: address, type: "sign-in", firstTouch: firstTouchPayload(getFirstTouch(), getConsent()) } as Parameters<
        typeof authClient.emailOtp.sendVerificationOtp
      >[0],
      { headers: { [CAPTCHA_HEADER]: token } },
    );
    resetCaptcha.current();
    setToken("");
    if (res.error) {
      setError(t.sendFailed);
      return false;
    }
    setCooldown(RESEND_COOLDOWN_S);
    return true;
  }

  async function onEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const address = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (await sendCode(address)) {
        setEmail(address);
        setStep("code");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const otp = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // firstTouch is an extra body field the app reads when this sign-in creates the account.
      const res = await authClient.signIn.emailOtp({
        email,
        otp,
        firstTouch: firstTouchPayload(getFirstTouch(), getConsent()),
      } as Parameters<typeof authClient.signIn.emailOtp>[0]);
      if (res.error) {
        setError(t.codeFailed);
        return;
      }
      window.location.assign(target);
    } finally {
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <AuthCard title={t.codeTitle} description={t.codeSent.replace("{email}", email)}>
        <form onSubmit={onCode} className="flex flex-col gap-4">
          <Field
            id="code"
            label={t.codeLabel}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,8}"
            maxLength={8}
            required
            autoFocus
            className="font-mono text-lg tracking-[0.4em]"
          />
          <FormError message={error} />
          <FormNotice message={notice} />
          <SubmitButton busy={busy}>{t.verify}</SubmitButton>
        </form>
        {cooldown > 0 ? (
          <p className="text-center text-sm text-fg-secondary">{t.resendIn.replace("{seconds}", String(cooldown))}</p>
        ) : (
          <>
            <Turnstile onToken={setToken} resetRef={resetCaptcha} />
            <SecondaryButton
              disabled={busy || !token}
              onClick={async () => {
                setError(null);
                if (await sendCode(email)) setNotice(t.resent);
              }}
            >
              {t.resend}
            </SecondaryButton>
          </>
        )}
        <button
          type="button"
          className="text-sm text-fg-secondary underline-offset-4 hover:text-fg hover:underline"
          onClick={() => {
            setStep("email");
            setError(null);
            setNotice(null);
          }}
        >
          {t.differentEmail}
        </button>
      </AuthCard>
    );
  }

  const [before, between, after] = splitTerms(t.terms);
  return (
    <AuthCard title={t.title} description={t.description}>
      <ProviderButtons callbackURL={target} />
      <OrDivider />
      <form onSubmit={onEmail} className="flex flex-col gap-4">
        <Field id="email" label={t.emailLabel} type="email" autoComplete="email" required defaultValue={email} />
        <Turnstile onToken={setToken} resetRef={resetCaptcha} />
        <FormError message={error} />
        <SubmitButton busy={busy} disabled={!token}>
          {t.sendCode}
        </SubmitButton>
      </form>
      <p className="text-center text-xs text-fg-secondary">
        {before}
        <TextLink href="/terms">{t.termsLink}</TextLink>
        {between}
        <TextLink href="/acceptable-use">{t.aupLink}</TextLink>
        {after}
      </p>
    </AuthCard>
  );
}

/** "By continuing you agree to our {terms} and {aup}." -> the text around the two links. */
function splitTerms(s: string): [string, string, string] {
  const [a = "", rest = ""] = s.split("{terms}");
  const [b = "", c = ""] = rest.split("{aup}");
  return [a, b, c];
}
