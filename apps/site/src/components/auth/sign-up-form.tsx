"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@content/auth";
import { getConsent, getFirstTouch } from "@/lib/analytics";
import { authClient } from "@/lib/auth/client";
import { APP_URL, CAPTCHA_HEADER } from "@/lib/auth/config";
import { firstTouchPayload } from "@/lib/auth/first-touch";
import { safeNext } from "@/lib/auth/safe-next";
import { GithubButton, OrDivider } from "./github-button";
import { AuthCard, Field, FormError, SubmitButton, TextLink } from "./parts";
import { Turnstile } from "./turnstile";

const t = auth.signUp;

export function SignUpForm() {
  const router = useRouter();
  const [aup, setAup] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resetCaptcha = useRef<() => void>(() => {});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (!aup || !token) return setError(t.captcha);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    setBusy(true);
    setError(null);
    try {
      // Extra body fields (aupAccepted, firstTouch) are read by the app's sign-up hook; the client types don't know them.
      const body = {
        name: String(fd.get("name") ?? ""),
        email,
        password: String(fd.get("password") ?? ""),
        callbackURL: "/welcome",
        aupAccepted: true,
        firstTouch: firstTouchPayload(getFirstTouch(), getConsent()),
      };
      const res = await authClient.signUp.email(body, { headers: { [CAPTCHA_HEADER]: token } });
      if (res.error) {
        setError(res.error.message ?? t.failed);
        resetCaptcha.current();
        return;
      }
      router.push(`/check-email?email=${encodeURIComponent(email)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t.title} description={t.description}>
      <GithubButton callbackURL={safeNext(null, APP_URL)} />
      <OrDivider />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field id="name" label={t.name} autoComplete="name" required maxLength={80} />
        <Field id="email" label={t.email} type="email" autoComplete="email" required />
        <Field id="password" label={t.password} type="password" autoComplete="new-password" required minLength={10} hint={t.passwordHint} />
        <label className="flex items-start gap-3 text-sm text-fg-secondary">
          <input
            type="checkbox"
            name="aup"
            required
            checked={aup}
            onChange={(e) => setAup(e.target.checked)}
            className="mt-1 size-5 accent-[var(--color-accent)]"
          />
          <span>
            {t.aupPrefix}{" "}
            <a href="/acceptable-use" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">
              {t.aupLink}
            </a>
            .
          </span>
        </label>
        <Turnstile onToken={setToken} resetRef={resetCaptcha} />
        <FormError message={error} />
        <SubmitButton busy={busy} disabled={!aup || !token}>
          {t.submit}
        </SubmitButton>
      </form>
      <p className="text-center text-sm text-fg-secondary">
        {t.haveAccount} <TextLink href="/sign-in">{t.signIn}</TextLink>
      </p>
    </AuthCard>
  );
}
