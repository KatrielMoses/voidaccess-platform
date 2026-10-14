"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
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
}: {
  name: string;
  email: string;
  providers: ProviderId[];
}) {
  return (
    <>
      <ProfileSection name={name} />
      <EmailSection email={email} />
      {providers.length ? <ConnectedSection providers={providers} /> : null}
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
        className="flex flex-col gap-4"
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
      <p className="font-mono text-sm text-fg">{email}</p>
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
      <ul className="flex flex-col gap-3">
        {providers.map((p) => {
          const accountId = linked?.[p];
          return (
            <li key={p} className="flex items-center justify-between gap-3">
              <span className="text-sm text-fg">
                {PROVIDER_LABEL[p]}:{" "}
                {linked === null ? "checking…" : accountId ? "connected" : "not connected"}
              </span>
              {linked === null ? null : accountId ? (
                <Button
                  variant="secondary"
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
    <Card className="border-danger/30">
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription>
          This removes your investigations, results and sign-in details for good. Credit history is kept in
          anonymous form for accounting. It can&apos;t be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
          <Button variant="danger" onClick={() => setOpen(true)}>
            Delete my account
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                Type <span className="font-mono text-fg">{email}</span> to confirm.
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
            <div className="mt-3">
              <FormError message={error} />
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Keep my account
              </Button>
              <Button
                variant="danger"
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
      </CardContent>
    </Card>
  );
}
