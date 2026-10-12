"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { auth } from "@content/auth";
import { authClient } from "@/lib/auth/client";
import { AuthCard, FormError, FormNotice, SecondaryButton, TextLink } from "./parts";

const t = auth.checkEmail;
const COOLDOWN_S = 60;

export function CheckEmail() {
  const email = useSearchParams().get("email") ?? "";
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function resend() {
    setBusy(true);
    try {
      const res = await authClient.sendVerificationEmail({ email, callbackURL: "/welcome" });
      setMsg(res.error ? { ok: false, text: res.error.message ?? t.resendFailed } : { ok: true, text: t.resent });
      // Cool down after every attempt: a 429 from the server means we are already too fast.
      setWait(COOLDOWN_S);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t.title} description={email ? t.withEmail.replace("{email}", email) : t.withoutEmail}>
      <p className="text-sm text-fg-secondary">{t.gate}</p>
      {msg?.ok ? <FormNotice message={msg.text} /> : <FormError message={msg?.text} />}
      {email ? (
        <SecondaryButton disabled={busy || wait > 0} onClick={resend}>
          {busy ? t.resending : wait > 0 ? t.cooldown.replace("{seconds}", String(wait)) : t.resend}
        </SecondaryButton>
      ) : null}
      <TextLink href="/sign-in">{t.back}</TextLink>
    </AuthCard>
  );
}
