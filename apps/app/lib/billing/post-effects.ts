/** Emails and analytics for billing events. Run after the webhook transaction commits; never throws. */
import { eq } from "drizzle-orm";
import { PLANS } from "@voidaccess/config";
import { getDatabase, users } from "@voidaccess/db";
import { sendEmail } from "@voidaccess/emails";
import { getEnv } from "../../env";
import { trackEvent } from "../analytics";
import { getBillingProvider } from "./provider";
import type { PostEffect } from "./webhook";
import { num } from "./format";

export const billingUrl = () => `${getEnv().APP_URL.replace(/\/$/, "")}/billing`;
export const appUrl = (path = "") => `${getEnv().APP_URL.replace(/\/$/, "")}${path}`;

export async function userContact(userId: string): Promise<{ email: string; name: string } | null> {
  const [u] = await getDatabase().withSystem(
    "billing.contact",
    (tx) => tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId)),
    { audit: false },
  );
  return u ?? null;
}

export async function runPostEffects(effects: PostEffect[]): Promise<void> {
  for (const e of effects) {
    try {
      const u = await userContact(e.userId);
      if (!u) continue;
      switch (e.kind) {
        case "welcome":
          await sendEmail("welcomePro", u.email, {
            name: u.name,
            plan: PLANS[e.plan].name,
            credits: num(PLANS[e.plan].monthlyCredits),
            url: appUrl("/investigations/new"),
            billingUrl: billingUrl(),
          });
          break;
        case "subscribed":
          await trackEvent("subscribed", {
            userId: e.userId,
            props: { plan: e.plan, interval: e.interval, founding: e.founding },
          });
          break;
        case "topup_purchased":
          await trackEvent("topup_purchased", { userId: e.userId, props: { usd: e.usd } });
          break;
        case "payment_failed": {
          let portalUrl = billingUrl();
          try {
            portalUrl = await portalLinkFor(e.userId);
          } catch {
            /* fall back to the billing page */
          }
          await sendEmail("paymentFailed", u.email, { name: u.name, portalUrl });
          break;
        }
      }
    } catch (err) {
      console.error("billing post-effect failed", e.kind, err instanceof Error ? err.message : err);
    }
  }
}

/** Dodo customer-portal link for the user (card, invoices, receipts). */
export async function portalLinkFor(userId: string): Promise<string> {
  const { ensureCustomer } = await import("./customers");
  const provider = getBillingProvider();
  const customerId = await ensureCustomer(userId, provider);
  return provider.portalLink(customerId);
}
