"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Button, Checkbox } from "@voidaccess/ui";
import { signUpAction, type FormState } from "@/lib/auth/actions";
import { Field, FormError } from "@/components/field";
import { SignupBeacon } from "@/components/signup-beacon";

export function SignUpForm({ aupUrl }: { aupUrl: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signUpAction, {});
  const [aup, setAup] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-4">
      <SignupBeacon />
      <Field id="name" label="Name" autoComplete="name" required maxLength={80} />
      <Field id="email" label="Email" type="email" autoComplete="email" required />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
      />
      <div className="flex items-start gap-3">
        <Checkbox
          id="aup"
          name="aup"
          required
          checked={aup}
          onCheckedChange={(v) => setAup(v === true)}
          className="mt-0.5"
        />
        <label htmlFor="aup" className="text-sm text-fg-secondary">
          I have read and accept the{" "}
          <a
            href={aupUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline underline-offset-2"
          >
            Acceptable Use Policy
          </a>
          .
        </label>
      </div>
      <FormError message={state.error} />
      <Button type="submit" loading={pending} size="lg" className="w-full">
        Create account
      </Button>
      <p className="text-center text-sm text-fg-secondary">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-accent underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </form>
  );
}
