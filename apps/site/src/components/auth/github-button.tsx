"use client";

import { useState } from "react";
import { auth } from "@content/auth";
import { APP_URL } from "@/lib/auth/config";
import { authClient } from "@/lib/auth/client";
import { SecondaryButton } from "./parts";

/** callbackURL and newUserCallbackURL are absolute app URLs; errors come back to this site's sign-in page. */
export function GithubButton({ callbackURL }: { callbackURL: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <SecondaryButton
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await authClient.signIn.social({
            provider: "github",
            callbackURL,
            errorCallbackURL: `${window.location.origin}/sign-in?error=oauth`,
            newUserCallbackURL: `${APP_URL}/welcome`,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      {auth.github}
    </SecondaryButton>
  );
}

export function OrDivider() {
  return (
    <p className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-fg-secondary" aria-hidden>
      <span className="h-px flex-1 bg-border-dim" />
      {auth.or}
      <span className="h-px flex-1 bg-border-dim" />
    </p>
  );
}
