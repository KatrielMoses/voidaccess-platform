"use client";

import { useSearchParams } from "next/navigation";
import { auth } from "@content/auth";
import { APP_URL } from "@/lib/auth/config";
import { AuthCard } from "./parts";
import { LinkButton } from "@/components/ui";

const t = auth.verified;

export function Verified() {
  const failed = Boolean(useSearchParams().get("error"));
  return failed ? (
    <AuthCard title={t.errorTitle} description={t.errorBody}>
      <LinkButton href="/sign-in">{t.errorCta}</LinkButton>
    </AuthCard>
  ) : (
    <AuthCard title={t.title} description={t.body}>
      <LinkButton href={`${APP_URL}/welcome`} className="w-full">
        {t.cta}
      </LinkButton>
    </AuthCard>
  );
}
