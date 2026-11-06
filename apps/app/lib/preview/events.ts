/**
 * Client-reported preview funnel events. The browser may only report these names, with an investigation id and,
 * for checkout_failed, one reason from a fixed list: counts and ids only, never report content.
 */
import { trackEvent } from "@/lib/analytics";

export const CLIENT_PREVIEW_EVENTS = ["preview_shown", "unlock_clicked", "checkout_failed"] as const;
export type ClientPreviewEvent = (typeof CLIENT_PREVIEW_EVENTS)[number];

/** Why a panel checkout didn't complete. Creem gives no reason of its own (no failure field, no failure event). */
export const CHECKOUT_FAILED_REASONS = [
  "returned_without_payment",
  "abandoned",
  "expired",
  "start_failed",
] as const;
export type CheckoutFailedReason = (typeof CHECKOUT_FAILED_REASONS)[number];

/** Where in the report the panel was opened from. */
export const UNLOCK_ORIGINS = [
  "panel",
  "summary",
  "entities",
  "entity_detail",
  "actors",
  "sources",
  "graph",
  "graph_node",
  "exports",
  "locked_response",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pick = <T extends string>(list: readonly T[], v: unknown): T | null =>
  list.includes(v as T) ? (v as T) : null;
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e7 ? v : null);

/** Validates a client body; returns null for anything outside the allowed shape. */
export function parseClientPreviewEvent(b: unknown): {
  name: ClientPreviewEvent;
  props: Record<string, unknown>;
} | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  const name = pick(CLIENT_PREVIEW_EVENTS, o.name);
  const investigationId =
    typeof o.investigationId === "string" && UUID.test(o.investigationId) ? o.investigationId : null;
  if (!name || !investigationId) return null;
  const props: Record<string, unknown> = { investigationId, source: "preview_unlock" };
  if (name === "preview_shown") {
    for (const k of ["sources", "entities", "actors"] as const) {
      const n = count(o[k]);
      if (n !== null) props[k] = n;
    }
  }
  if (name === "unlock_clicked") {
    props.origin = pick(UNLOCK_ORIGINS, o.origin) ?? "panel";
    if (typeof o.founding === "boolean") props.founding = o.founding;
  }
  if (name === "checkout_failed") {
    const reason = pick(CHECKOUT_FAILED_REASONS, o.reason);
    if (!reason) return null;
    props.reason = reason;
    if (typeof o.providerStatus === "string" && /^[a-z_]{1,20}$/.test(o.providerStatus))
      props.providerStatus = o.providerStatus;
    if (typeof o.checkoutRef === "string" && UUID.test(o.checkoutRef)) props.checkoutRef = o.checkoutRef;
  }
  return { name, props };
}

/** One literal call per event, so test/analytics-coverage can see each emitter. */
export function emitClientPreviewEvent(
  userId: string,
  e: { name: ClientPreviewEvent; props: Record<string, unknown> },
): Promise<boolean> {
  switch (e.name) {
    case "preview_shown":
      return trackEvent("preview_shown", { userId, props: e.props });
    case "unlock_clicked":
      return trackEvent("unlock_clicked", { userId, props: e.props });
    case "checkout_failed":
      return trackEvent("checkout_failed", { userId, props: e.props });
  }
}
