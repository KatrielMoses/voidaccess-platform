"use client";

import { useState } from "react";
import { auth } from "@content/auth";
import { AUTH_PROVIDERS, type AuthProvider } from "@/lib/auth/config";
import { authClient } from "@/lib/auth/client";
import { SecondaryButton } from "./parts";

/** One button per configured provider. Success lands on the app; errors come back to this site's sign-in page. */
export function ProviderButtons({ callbackURL }: { callbackURL: string }) {
  const [busy, setBusy] = useState<AuthProvider | null>(null);
  if (!AUTH_PROVIDERS.length) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {AUTH_PROVIDERS.map((provider) => (
        <SecondaryButton
          key={provider}
          disabled={busy !== null}
          onClick={async () => {
            setBusy(provider);
            try {
              await authClient.signIn.social({
                provider,
                callbackURL,
                errorCallbackURL: `${window.location.origin}/sign-in?error=oauth`,
              });
            } finally {
              setBusy(null);
            }
          }}
        >
          {auth.providers[provider]}
        </SecondaryButton>
      ))}
    </div>
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
