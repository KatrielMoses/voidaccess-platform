import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { assertSameOrigin } from "@/lib/account/csrf";
import { trackEvent } from "@/lib/analytics";
import {
  asCheckoutSource,
  createSubscriptionCheckout,
  createTopupCheckout,
  type CheckoutReturn,
} from "@/lib/billing/checkout";
import { investigationOfPath, safeReturnPath } from "@/lib/preview/offer";

export const dynamic = "force-dynamic";

const STATUS = {
  plan_invalid: 400,
  topup_invalid: 400,
  already_subscribed: 409,
  founding_unavailable: 409,
  not_in_catalog: 503,
} as const;

/**
 * POST { kind: "subscription", plan, interval, founding?, source?, returnTo? } | { kind: "topup", usd } -> { url, ref }
 * (Creem test/live checkout). `returnTo` (subscriptions from the unlock panel) must be one of this app's report paths;
 * anything else is refused, so the success URL can never point off-site.
 */
export function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) => {
    const b = (await req.json().catch(() => null)) as {
      kind?: string;
      plan?: string;
      interval?: string;
      founding?: boolean;
      usd?: unknown;
      source?: unknown;
      returnTo?: unknown;
    } | null;
    if (!b) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    let ret: CheckoutReturn | undefined;
    if (b.kind !== "topup" && (b.returnTo !== undefined || b.source !== undefined)) {
      const path = safeReturnPath(b.returnTo);
      const source = asCheckoutSource(b.source);
      if (!path || !source) return NextResponse.json({ error: "return_invalid" }, { status: 400 });
      ret = { path, source };
    }
    const r =
      b.kind === "topup"
        ? await createTopupCheckout(user.id, b.usd)
        : await createSubscriptionCheckout(user.id, {
            plan: b.plan as never,
            interval: b.interval as never,
            founding: b.founding === true,
            ret,
          });
    if (!r.ok) return NextResponse.json({ error: r.error, reason: r.reason }, { status: STATUS[r.error] });
    await trackEvent("checkout_started", {
      userId: user.id,
      props: {
        kind: b.kind === "topup" ? "topup" : "subscription",
        key: r.key,
        checkoutRef: r.ref,
        source: ret?.source ?? "billing",
        ...(ret ? { investigationId: investigationOfPath(ret.path) } : {}),
      },
    });
    return NextResponse.json({ url: r.url, ref: r.ref });
  });
}
