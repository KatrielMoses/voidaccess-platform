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

export function SettingsForms({
  name,
  email,
  emailVerified,
  githubEnabled,
}: {
  name: string;
  email: string;
  emailVerified: boolean;
  githubEnabled: boolean;
}) {
  return (
    <>
      <ProfileSection name={name} />
      <EmailSection email={email} verified={emailVerified} />
      <PasswordSection />
      {githubEnabled ? <GithubSection /> : null}
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

function EmailSection({ email, verified }: { email: string; verified: boolean }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result>(null);
  return (
    <Section
      title="Email"
      description={`Signed in as ${email}${verified ? "" : " (not confirmed yet)"}. A new address only takes effect after you confirm it from your inbox.`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const res = await authClient.changeEmail({
            newEmail: String(new FormData(e.currentTarget).get("newEmail") ?? ""),
            callbackURL: "/settings",
          });
          setBusy(false);
          setR(
            res.error
              ? { ok: false, text: res.error.message ?? "Could not change the email" }
              : { ok: true, text: "Check your inbox for a confirmation link." },
          );
        }}
      >
        <Field id="newEmail" label="New email" type="email" required autoComplete="email" />
        <Msg r={r} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>
            Change email
          </Button>
          {!verified ? (
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                const res = await authClient.sendVerificationEmail({ email, callbackURL: "/settings" });
                setR(
                  res.error
                    ? { ok: false, text: res.error.message ?? "Could not send" }
                    : { ok: true, text: "Verification email sent." },
                );
              }}
            >
              Resend verification
            </Button>
          ) : null}
        </div>
      </form>
    </Section>
  );
}

function PasswordSection() {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result>(null);
  return (
    <Section title="Password" description="Changing it signs you out of your other devices.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          setBusy(true);
          const res = await authClient.changePassword({
            currentPassword: String(fd.get("currentPassword") ?? ""),
            newPassword: String(fd.get("newPassword") ?? ""),
            revokeOtherSessions: true,
          });
          setBusy(false);
          if (res.error) setR({ ok: false, text: res.error.message ?? "Could not change the password" });
          else {
            setR({ ok: true, text: "Password changed." });
            form.reset();
          }
        }}
      >
        <Field
          id="currentPassword"
          label="Current password"
          type="password"
          required
          autoComplete="current-password"
        />
        <Field
          id="newPassword"
          label="New password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          hint="At least 10 characters."
        />
        <Msg r={r} />
        <Button type="submit" loading={busy} className="self-start">
          Change password
        </Button>
      </form>
    </Section>
  );
}

function GithubSection() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [githubAccountId, setGithubAccountId] = useState("");
  const [r, setR] = useState<Result>(null);
  useEffect(() => {
    authClient.listAccounts().then((res) => {
      const list = (res.data ?? []) as Array<{ providerId?: string; provider?: string; accountId?: string }>;
      const gh = list.find((a) => (a.providerId ?? a.provider) === "github");
      setGithubAccountId(gh?.accountId ?? "");
      setConnected(Boolean(gh));
    });
  }, []);
  return (
    <Section title="Connected accounts" description="Sign in with GitHub.">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-fg">
          GitHub: {connected === null ? "checking…" : connected ? "connected" : "not connected"}
        </span>
        {connected === false ? (
          <Button
            variant="secondary"
            onClick={() => authClient.linkSocial({ provider: "github", callbackURL: "/settings" })}
          >
            Connect GitHub
          </Button>
        ) : connected ? (
          <Button
            variant="secondary"
            onClick={async () => {
              const res = await authClient.unlinkAccount({
                providerId: "github",
                accountId: githubAccountId,
              } as Parameters<typeof authClient.unlinkAccount>[0]);
              if (res.error)
                setR({
                  ok: false,
                  text: res.error.message ?? "Could not disconnect (it may be your only sign-in method)",
                });
              else setConnected(false);
            }}
          >
            Disconnect
          </Button>
        ) : null}
      </div>
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
