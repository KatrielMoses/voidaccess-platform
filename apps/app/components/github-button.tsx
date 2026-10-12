"use client";
import { useState } from "react";
import { Button } from "@voidaccess/ui";
import { authClient } from "@/lib/auth/client";

export function GithubButton({ label = "Continue with GitHub" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      className="w-full"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signIn.social({ provider: "github", callbackURL: "/welcome" });
        setBusy(false);
      }}
    >
      {label}
    </Button>
  );
}
