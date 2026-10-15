"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  buttonVariants,
} from "@voidaccess/ui";
import { authClient } from "@/lib/auth/client";
import { SIGN_IN_URL } from "@/lib/site";
import { Field, FormError, FormNotice } from "@/components/field";
import { Row } from "@/components/page-header";

type Result = { ok: boolean; text: string } | null;

function Msg({ r }: { r: Result }) {
  if (!r) return null;
  return r.ok ? <FormNotice message={r.text} /> : <FormError message={r.text} />;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Row title={title} note={description}>
      {children}
    </Row>
  );
}

export type ProviderId = "google" | "microsoft" | "github";
const PROVIDER_LABEL: Record<ProviderId, string> = {
  google: "Google",
  microsoft: "Microsoft",
  github: "GitHub",
};

export function SettingsForms({
  name,
  email,
  providers,
  notifications,
}: {
  name: string;
  email: string;
  providers: ProviderId[];
  notifications?: React.ReactNode;
}) {
  return (
    <>
      <ProfileSection name={name} />
      <EmailSection email={email} />
      {providers.length ? <ConnectedSection providers={providers} /> : null}
      {notifications}
      <SessionsSection />
      <ExportSection />
      <DeleteSection email={email} />
    </>
  );
}

function ProfileSection({ name }: { name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result>(null);
  return (
    <Section title="Profile">
      <form
        className="flex max-w-[460px] flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const res = await authClient.updateUser({
            name: String(new FormData(e.currentTarget).get("name") ?? "").trim(),
          });
          setBusy(false);
          setR(
            res.error
              ? { ok: false, text: res.error.message ?? "Could not save" }
              : { ok: true, text: "Saved." },
          );
          router.refresh();
        }}
      >
        <Field id="name" label="Name" defaultValue={name} required maxLength={80} autoComplete="name" />
        <Msg r={r} />
        <Button type="submit" loading={busy} className="self-start">
          Save name
        </Button>
      </form>
    </Section>
  );
}

function EmailSection({ email }: { email: string }) {
  return (
    <Section
      title="Email"
      description="Sign-in is passwordless: a one-time code to this address, or a connected Google, Microsoft or GitHub account with the same email."
    >
      <p className="inline-flex h-9 items-center self-start rounded-sm border border-line px-3.5 font-mono text-[13px] text-paper">
        {email}
      </p>
    </Section>
  );
}

function ConnectedSection({ providers }: { providers: ProviderId[] }) {
  const [linked, setLinked] = useState<Record<string, string> | null>(null); // providerId -> accountId
  const [r, setR] = useState<Result>(null);
  useEffect(() => {
    authClient.listAccounts().then((res) => {
      const list = (res.data ?? []) as Array<{ providerId?: string; provider?: string; accountId?: string }>;
      setLinked(Object.fromEntries(list.map((a) => [a.providerId ?? a.provider ?? "", a.accountId ?? ""])));
    });
  }, []);
  return (
    <Section title="Connected accounts" description="Sign in with any connected account.">
      <ul className="flex flex-col border-t border-line">
        {providers.map((p) => {
          const accountId = linked?.[p];
          return (
            <li
              key={p}
              className="flex min-h-16 items-center justify-between gap-3 border-b border-line py-3"
            >
              <span className="flex flex-col gap-1">
                <span className="text-[15px] font-medium text-paper">{PROVIDER_LABEL[p]}</span>
                <span className="flex items-center gap-2 font-mono text-[12px] text-dim">
                  {linked === null ? (
                    "checking…"
                  ) : accountId ? (
                    <>
                      <span aria-hidden className="text-paper">
                        ✓
                      </span>
                      connected
                    </>
                  ) : (
                    <>
                      <span aria-hidden className="size-1.5 rounded-full border border-current" />
                      not connected
                    </>
                  )}
                </span>
              </span>
              {linked === null ? null : accountId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    const res = await authClient.unlinkAccount({ providerId: p, accountId } as Parameters<
                      typeof authClient.unlinkAccount
                    >[0]);
                    if (res.error)
                      setR({
                        ok: false,
                        text:
                          res.error.message ?? "Could not disconnect (it may be your only sign-in method)",
                      });
                    else setLinked((l) => ({ ...(l ?? {}), [p]: "" }));
                  }}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => authClient.linkSocial({ provider: p, callbackURL: "/settings" })}
                >
                  Connect {PROVIDER_LABEL[p]}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <Msg r={r} />
    </Section>
  );
}
function SessionsSection() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Sessions" description="Sign out of every device, including this one.">
      <Button
        variant="secondary"
        loading={busy}
        className="self-start"
        onClick={async () => {
          setBusy(true);
          await authClient.revokeSessions();
          window.location.assign(SIGN_IN_URL);
          router.refresh();
        }}
      >
        Sign out of all sessions
      </Button>
    </Section>
  );
}

function ExportSection() {
  return (
    <Section
      title="Your data"
      description="Download everything we hold about you as JSON: your profile, investigations, results and credit history."
    >
      <a
        href="/api/account/export"
        download
        className={buttonVariants({ variant: "secondary" }) + " self-start"}
      >
        Download my data
      </a>
    </Section>
  );
}

function DeleteSection({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const match = typed.trim().toLowerCase() === email.toLowerCase();
  return (
    <Row
      title="Delete account"
      note="This removes your investigations, results and sign-in details for good. Credit history is kept in anonymous form for accounting. It can't be undone."
      className="border-b"
    >
      <div>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) {
              setTyped("");
              setError(null);
            }
          }}
        >
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Delete my account
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                Type <span className="font-mono text-[14px] text-paper">{email}</span> to confirm.
              </DialogDescription>
            </DialogHeader>
            <label htmlFor="confirm-delete" className="sr-only">
              Type your email to confirm
            </label>
            <Input
              id="confirm-delete"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              placeholder={email}
            />
            {error ? (
              <div className="mt-3">
                <FormError message={error} />
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Keep my account
              </Button>
              <Button
                variant="secondary"
                disabled={!match}
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const res = await fetch("/api/account/delete", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ confirm: typed }),
                  });
                  if (res.ok) {
                    window.location.assign(SIGN_IN_URL);
                    return;
                  }
                  setBusy(false);
                  setError("Could not delete the account. Check the email and try again.");
                }}
              >
                Delete forever
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Row>
  );
}
