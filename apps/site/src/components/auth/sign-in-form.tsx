"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { auth } from "@content/auth";
import { getConsent, getFirstTouch } from "@/lib/analytics";
import { authClient } from "@/lib/auth/client";
import { APP_URL, CAPTCHA_HEADER } from "@/lib/auth/config";
import { GITHUB_URL } from "@/lib/site";
import { firstTouchPayload } from "@/lib/auth/first-touch";
import { safeNext } from "@/lib/auth/safe-next";
import { signedIn } from "@/lib/auth/signed-in";
import { leave } from "@/lib/motion";
import { lockField, rippleOnKey } from "../calm-field";
import { AuthCard, Field, FormError, FormNotice, SecondaryButton, SubmitButton, TextLink } from "./parts";
import { OrDivider, ProviderButtons } from "./provider-buttons";
import { Turnstile } from "./turnstile";

const t = auth.signIn;
const RESEND_COOLDOWN_S = 30;

/**
 * One page for everyone: Google, Microsoft, GitHub, or a 6-digit code by email. The first sign-in creates the
 * account; afterwards the same steps simply sign the user back in. `description` (credit numbers from config) and
 * `github` (the live star count) are resolved on the server by the page.
 */
/** How long a send waits for the invisible captcha's token before asking the visitor to retry. */
const CAPTCHA_WAIT_MS = 8000;

export function SignInForm({ description, github }: { description: string; github: string }) {
  const params = useSearchParams();
  const target = safeNext(params.get("next"), APP_URL);
  // already signed in (the session is shared with the app's domain): go straight on instead of asking again
  useEffect(() => {
    if (params.get("error")) return; // came back from a failed provider sign-in: show the form and the message
    void signedIn().then((yes) => {
      if (yes) window.location.replace(target);
    });
  }, [params, target]);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  // The captcha is invisible: its token arrives on its own shortly after load. Sending waits for it (CAPTCHA_WAIT_MS)
  // instead of disabling the button; the widget only shows itself when Cloudflare wants a human check.
  const token = useRef("");
  const tokenWaiters = useRef<((t: string) => void)[]>([]);
  const onToken = useCallback((t: string) => {
    token.current = t;
    if (t) for (const w of tokenWaiters.current.splice(0)) w(t);
  }, []);
  const nextToken = () =>
    token.current
      ? Promise.resolve(token.current)
      : new Promise<string>((resolve) => {
          const timer = setTimeout(() => resolve(""), CAPTCHA_WAIT_MS);
          tokenWaiters.current.push((t) => {
            clearTimeout(timer);
            resolve(t);
          });
        });
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(params.get("error") ? t.oauthFailed : null);
  const [notice, setNotice] = useState<string | null>(null);
  const resetCaptcha = useRef<() => void>(() => {});
  // Motion only: the card that is on screen (it fades out before the step changes), and whether a step has changed
  // yet (the first card plays the page's load sequence, later ones a section-head entrance).
  const card = useRef<HTMLDivElement>(null);
  const [stepped, setStepped] = useState(false);
  async function goTo(next: "email" | "code") {
    await leave(card.current);
    setStepped(true);
    setStep(next);
  }

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function sendCode(address: string): Promise<boolean> {
    const captcha = await nextToken();
    if (!captcha) {
      setError(t.captcha);
      return false;
    }
    // firstTouch here only attributes the `signup_started` event; the sign-in step stores it on a new account.
    const res = await authClient.emailOtp.sendVerificationOtp(
      { email: address, type: "sign-in", firstTouch: firstTouchPayload(getFirstTouch(), getConsent()) } as Parameters<
        typeof authClient.emailOtp.sendVerificationOtp
      >[0],
      { headers: { [CAPTCHA_HEADER]: captcha } },
    );
    resetCaptcha.current();
    token.current = "";
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
        lockField();
        setEmail(address);
        await goTo("code");
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
      lockField();
      window.location.assign(target);
    } finally {
      setBusy(false);
    }
  }

  const entrance = stepped ? "step" : "load";
  if (step === "code") {
    return (
      <div ref={card} key="code">
        <AuthCard title={t.codeTitle} description={t.codeSent.replace("{email}", email)} entrance={entrance}>
          <form onSubmit={onCode} className="flex flex-col gap-5">
            <Field
              id="code"
              onKeyDown={rippleOnKey}
              label={t.codeLabel}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,8}"
              maxLength={8}
              required
              autoFocus
              className="va-input-code"
            />
            <FormError message={error} />
            <FormNotice message={notice} />
            <SubmitButton busy={busy}>{t.verify}</SubmitButton>
          </form>
          {cooldown > 0 ? (
            <p className="text-[15px] text-mute tabular-nums" data-va-up>
              {t.resendIn.replace("{seconds}", String(cooldown))}
            </p>
          ) : (
            <>
              <Turnstile onToken={onToken} resetRef={resetCaptcha} />
              <SecondaryButton
                disabled={busy}
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
            className="va-ul self-start"
            data-va-up
            onClick={() => {
              setError(null);
              setNotice(null);
              void goTo("email");
            }}
          >
            {t.differentEmail}
          </button>
        </AuthCard>
      </div>
    );
  }

  const [before, between, after] = splitTerms(t.terms);
  return (
    <div ref={card} key="email">
      <AuthCard title={t.title} description={description} entrance={entrance}>
        <ProviderButtons callbackURL={target} />
        <OrDivider />
        <form onSubmit={onEmail} className="flex flex-col gap-5">
          <Field id="email" label={t.emailLabel} type="email" autoComplete="email" required defaultValue={email} onKeyDown={rippleOnKey} />
          <Turnstile onToken={onToken} resetRef={resetCaptcha} />
          <FormError message={error} />
          <SubmitButton busy={busy}>
            {t.sendCode}
          </SubmitButton>
        </form>
        <p className="text-[15px] leading-normal text-mute" data-va-up>
          {before}
          <TextLink href="/terms">{t.termsLink}</TextLink>
          {between}
          <TextLink href="/acceptable-use">{t.aupLink}</TextLink>
          {after}
        </p>
        <p className="text-[15px] leading-normal text-mute" data-va-up>
          <a className="va-tl" href={GITHUB_URL} target="_blank" rel="noopener">
            {github}
          </a>
        </p>
      </AuthCard>
    </div>
  );
}

/** "By continuing you agree to our {terms} and {aup}." -> the text around the two links. */
function splitTerms(s: string): [string, string, string] {
  const [a = "", rest = ""] = s.split("{terms}");
  const [b = "", c = ""] = rest.split("{aup}");
  return [a, b, c];
}
