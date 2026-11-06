/** Browser side of the preview funnel: fire-and-forget posts to /api/preview/events. Never throws. */
export function sendPreviewEvent(
  body: Record<string, unknown> & { name: string; investigationId: string },
): void {
  try {
    void fetch("/api/preview/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* analytics must never break the page */
  }
}

/** A panel checkout in flight: set just before the redirect to Creem, read when the browser comes back. */
export const PENDING_KEY = "va:unlock-pending";
export interface PendingUnlock {
  ref: string;
  investigationId: string;
  at: number;
}

export function readPending(): PendingUnlock | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as PendingUnlock | null;
    return v && typeof v.ref === "string" && typeof v.investigationId === "string" && typeof v.at === "number"
      ? v
      : null;
  } catch {
    return null;
  }
}
export function writePending(p: PendingUnlock): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* private mode: the return page still works from ?unlock= */
  }
}
export function clearPending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** True the first time in this browser session (per key); later calls return false. */
export function firstInSession(key: string): boolean {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

/** What /api/billing/checkout/status answers. */
export interface UnlockStatus {
  paidPlan: boolean;
  completed: boolean;
  provider: "pending" | "processing" | "completed" | "expired" | "unknown" | null;
}

/** Back from Creem after this long without paying reads as abandoned rather than a quick return. */
export const ABANDONED_AFTER_MS = 30 * 60_000;

/** The reason we record for a panel checkout that came back without a payment. Creem itself gives none. */
export function failureReason(
  s: UnlockStatus | null,
  ageMs: number,
): "expired" | "abandoned" | "returned_without_payment" {
  if (s?.provider === "expired") return "expired";
  return ageMs > ABANDONED_AFTER_MS ? "abandoned" : "returned_without_payment";
}
