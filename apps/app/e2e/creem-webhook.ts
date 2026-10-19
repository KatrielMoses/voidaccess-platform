// Creem webhook deliveries for e2e: `creem-signature` = hex HMAC-SHA256 of the raw body, keyed by the secret.
import { createHmac, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { WEBHOOK_SECRET } from "./billing-global-setup";

export function signed(eventType: string, object: Record<string, unknown>, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify({ id: `evt_e2e_${randomUUID()}`, eventType, created_at: Date.now(), object });
  return {
    body,
    headers: {
      "content-type": "application/json",
      "creem-signature": createHmac("sha256", secret).update(body).digest("hex"),
    },
  };
}

export async function deliver(
  request: APIRequestContext,
  eventType: string,
  object: Record<string, unknown>,
) {
  const s = signed(eventType, object);
  return request.post("/api/webhooks/creem", { data: s.body, headers: s.headers });
}

/** A Creem subscription snapshot (product and customer expanded), as subscription.* events carry it. */
export function subscriptionObject(o: {
  subId: string;
  productId: string;
  customer: string;
  email: string;
  userId: string;
  status?: string;
  start?: Date;
}) {
  const start = o.start ?? new Date();
  return {
    id: o.subId,
    object: "subscription",
    product: { id: o.productId, currency: "USD", billing_type: "recurring", mode: "test" },
    customer: { id: o.customer, email: o.email, mode: "test" },
    status: o.status ?? "active",
    current_period_start_date: start.toISOString(),
    current_period_end_date: new Date(start.getTime() + 30 * 86_400_000).toISOString(),
    canceled_at: null,
    metadata: { user_id: o.userId },
    mode: "test",
  };
}

/** checkout.completed for a top-up checkout our server recorded (billing_checkouts row). */
export function topupCheckoutCompleted(o: {
  checkoutRef: string;
  checkoutId: string;
  amountCents: number;
  productId: string;
  customer: string;
  userId: string;
}) {
  return {
    id: o.checkoutId,
    object: "checkout",
    request_id: o.checkoutRef,
    order: {
      id: `ord_e2e_${o.checkoutRef.slice(0, 8)}`,
      customer: o.customer,
      product: o.productId,
      amount: o.amountCents,
      sub_total: o.amountCents,
      tax_amount: 0,
      discount_amount: 0,
      amount_paid: o.amountCents,
      currency: "USD",
      status: "paid",
      type: "onetime",
      created_at: new Date().toISOString(),
      mode: "test",
    },
    product: { id: o.productId, billing_type: "onetime", mode: "test" },
    customer: { id: o.customer, mode: "test" },
    units: 1,
    custom_price: o.amountCents,
    status: "completed",
    metadata: { user_id: o.userId, key: "topup_credits", checkout_ref: o.checkoutRef },
    mode: "test",
  };
}
