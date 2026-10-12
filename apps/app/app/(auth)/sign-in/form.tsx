"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@voidaccess/ui";
import { authClient } from "@/lib/auth/client";
import { Field, FormError, FormNotice } from "@/components/field";

type Mode = "password" | "magic";

export function SignInForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "magic") {
        const res = await authClient.signIn.magicLink({ email, callbackURL: "/welcome" });
        if (res.error) setError(res.error.message ?? "Could not send the link");
        else setNotice("Check your inbox. The link works once and expires in 5 minutes.");
        return;
      }
      const res = await authClient.signIn.email({
        email,
        password: String(fd.get("password") ?? ""),
        callbackURL: "/welcome",
      });
      if (res.error) {
        if (res.error.status === 403) {
          setError("Confirm your email first. We just sent you a new verification link.");
        } else {
          setError(res.error.message ?? "Wrong email or password");
        }
        return;
      }
      router.push("/welcome");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field id="email" label="Email" type="email" autoComplete="email" required />
      {mode === "password" ? (
        <div className="flex flex-col gap-1.5">
          <Field id="password" label="Password" type="password" autoComplete="current-password" required />
          <Link href="/forgot-password" className="self-end text-xs text-accent underline underline-offset-2">
            Forgot your password?
          </Link>
        </div>
      ) : null}
      <FormError message={error} />
      <FormNotice message={notice} />
      <Button type="submit" loading={busy} size="lg" className="w-full">
        {mode === "password" ? "Sign in" : "Email me a sign-in link"}
      </Button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === "password" ? "magic" : "password");
          setError(null);
          setNotice(null);
        }}
        className="text-sm text-fg-secondary underline underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
      >
        {mode === "password" ? "Use an email link instead" : "Use a password instead"}
      </button>
    </form>
  );
}
