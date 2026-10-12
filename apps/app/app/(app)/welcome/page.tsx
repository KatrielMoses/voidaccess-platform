import { DEPTHS } from "@voidaccess/config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@voidaccess/ui";
import { pageUser } from "@/lib/page-user";
import { readBalance } from "@/lib/account/balance";
import { getDatabase } from "@voidaccess/db";
import { users } from "@voidaccess/db/schema";
import { eq } from "drizzle-orm";
import { QueryForm } from "@/components/query-form";
import { ProfileCard } from "./profile-card";

export const metadata = { title: "Welcome | VoidAccess" };

export default async function WelcomePage() {
  const user = await pageUser();
  const balance = await readBalance(user.id);
  const [profile] = await getDatabase().withUser(user.id, (tx) =>
    tx
      .select({ role: users.profileRole, useCase: users.profileUseCase })
      .from(users)
      .where(eq(users.id, user.id)),
  );
  const askProfile = !profile?.role && !profile?.useCase;
  const firstName = user.name.split(" ")[0] ?? user.name;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Welcome, {firstName}
        </h1>
        <p className="text-fg-secondary">
          Search the dark web for a threat actor, malware family, CVE or brand. You get a sourced report.
        </p>
      </section>

      <QueryForm
        balance={balance}
        emailVerified={user.emailVerified}
        email={user.email}
        fixedDepth="quick"
        showExamples
        autoFocus
      />

      <Card>
        <CardHeader>
          <CardTitle>What credits are</CardTitle>
          <CardDescription>
            Each investigation costs a fixed number of credits, shown before you start. You have{" "}
            <span className="font-mono text-fg" data-testid="welcome-balance">
              {balance.toLocaleString("en-US")}
            </span>{" "}
            credits.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            <li className="flex justify-between rounded-md bg-raised px-3 py-2">
              <span>Quick investigation</span>
              <span className="font-mono text-accent">{DEPTHS.quick.credits} credits</span>
            </li>
            <li className="flex justify-between rounded-md bg-raised px-3 py-2">
              <span>Standard investigation</span>
              <span className="font-mono text-accent">{DEPTHS.standard.credits} credits</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {askProfile ? <ProfileCard /> : null}
    </div>
  );
}
