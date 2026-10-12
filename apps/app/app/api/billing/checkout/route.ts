import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { assertSameOrigin } from "@/lib/account/csrf";
import { createSubscriptionCheckout, createTopupCheckout } from "@/lib/billing/checkout";

export const dynamic = "force-dynamic";

const STATUS = {
  plan_invalid: 400,
  topup_invalid: 400,
  already_subscribed: 409,
  founding_unavailable: 409,
  not_in_catalog: 503,
} as const;

/** POST { kind: "subscription", plan, interval, founding? } | { kind: "topup", usd } -> { url } (Dodo test/live checkout). */
export function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) => {
    const b = (await req.json().catch(() => null)) as {
      kind?: string;
      plan?: string;
      interval?: string;
      founding?: boolean;
      usd?: number;
    } | null;
    if (!b) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const r =
      b.kind === "topup"
        ? await createTopupCheckout(user.id, Number(b.usd))
        : await createSubscriptionCheckout(user.id, {
            plan: b.plan as never,
            interval: b.interval as never,
            founding: b.founding === true,
          });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: STATUS[r.error] });
    return NextResponse.json({ url: r.url });
  });
}
