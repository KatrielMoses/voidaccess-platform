/**
 * The NOWPayments account (and its IPN secret) is shared with MailAccess, so a validly signed callback can belong to
 * the other product. Every VoidAccess invoice carries order_id "va_<crypto_orders id>" (MailAccess uses "ma_");
 * the IPN handler accepts only "va_" callbacks and rejects everything else before touching the database.
 */
export const ORDER_PREFIX = "va_";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The order_id we send to NOWPayments for one of our crypto_orders rows. */
export const toProviderOrderId = (orderId: string): string => `${ORDER_PREFIX}${orderId}`;

/** Our crypto_orders id from a callback's order_id, or null when it isn't a VoidAccess order. */
export function fromProviderOrderId(v: unknown): string | null {
  if (typeof v !== "string" || !v.startsWith(ORDER_PREFIX)) return null;
  const id = v.slice(ORDER_PREFIX.length);
  return UUID_RE.test(id) ? id : null;
}
