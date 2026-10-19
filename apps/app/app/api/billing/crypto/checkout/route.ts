import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { assertSameOrigin } from "@/lib/account/csrf";
import { createCryptoCheckout, parseCryptoCheckout } from "@/lib/billing/crypto/checkout";
import { cryptoEnabled } from "@/lib/billing/crypto/provider";
import { billingCopy } from "@/content/billing";

export const dynamic = "force-dynamic";

const STATUS = {
  disabled: 404,
  bad_request: 400,
  topup_invalid: 400,
  plan_invalid: 400,
  already_subscribed: 409,
  pass_active: 409,
  provider_error: 502,
} as const;

/** POST { kind: "topup", usd } | { kind: "pass", plan, interval } -> { url } (NOWPayments hosted invoice). */
export function POST(req: Request) {
  if (!cryptoEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) => {
    const parsed = parseCryptoCheckout(await req.json().catch(() => null));
    if (!parsed.ok)
      return NextResponse.json(
        { error: parsed.error, reason: parsed.reason },
        { status: STATUS[parsed.error] },
      );
    const r = await createCryptoCheckout(user.id, parsed.input);
    if (!r.ok)
      return NextResponse.json(
        {
          error: r.error,
          reason: r.reason,
          ...(r.error === "pass_active" ? { message: billingCopy.crypto.passActive } : {}),
        },
        { status: STATUS[r.error] },
      );
    return NextResponse.json({ url: r.url });
  });
}
