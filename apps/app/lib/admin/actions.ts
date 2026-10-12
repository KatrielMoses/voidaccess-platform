/**
 * Admin actions. Each runs in ONE system transaction with the change and its audit_log row, so a change without a
 * trail (or a trail without a change) cannot happen. Reasons are required and stored on the row. withSystem is given the
 * admin as actor and a specific reason string, so `grep withSystem` and the audit table both say who did what.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  abuseFlags,
  adminGrant,
  blockedEmailDomains,
  getDatabase,
  investigations,
  invEntities,
  invSources,
  invSummary,
  refund,
  sessions,
  users,
  type Database,
} from "@voidaccess/db";
import { removeFromArchive, type ArchiveObjectStore, type RemovalKind } from "@voidaccess/archive";
import { requireReason, writeAudit } from "./audit";
import { MAX_ADMIN_GRANT } from "./constants";
import { AdminError } from "./errors";

type Actor = { id: string };
type Opts = { database?: Database };
const db = (o?: Opts) => o?.database ?? getDatabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(v: unknown, what = "id"): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new AdminError(400, `Invalid ${what}`);
  return v;
}

// ---- users ----------------------------------------------------------------------------------------------------------

export type StatusAction = "suspend" | "unsuspend" | "ban";
const TARGET_STATUS = { suspend: "suspended", unsuspend: "active", ban: "banned" } as const;

/** suspend / unsuspend / ban. A ban also revokes every session. An admin can't change their own status (no lockout). */
export async function setUserStatus(
  admin: Actor,
  userId: string,
  action: StatusAction,
  rawReason: unknown,
  o?: Opts,
): Promise<{ from: string; to: string; sessionsRevoked: number }> {
  assertUuid(userId, "user id");
  if (!(action in TARGET_STATUS)) throw new AdminError(400, "Unknown action");
  const reason = requireReason(rawReason);
  if (userId === admin.id) throw new AdminError(409, "You can't change your own account status");
  return db(o).withSystem(
    `admin.user.${action}`,
    async (tx) => {
      const [u] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId));
      if (!u) throw new AdminError(404, "User not found");
      const to = TARGET_STATUS[action];
      await tx.update(users).set({ status: to }).where(eq(users.id, userId));
      let sessionsRevoked = 0;
      if (action === "ban")
        sessionsRevoked = (
          await tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id })
        ).length;
      await writeAudit(tx, {
        actor: admin.id,
        action: `admin.user.${action}`,
        target: userId,
        reason,
        meta: { targetUserId: userId, from: u.status, to, sessionsRevoked },
      });
      return { from: u.status, to, sessionsRevoked };
    },
    { actor: admin.id },
  );
}

export async function revokeSessions(admin: Actor, userId: string, rawReason: unknown, o?: Opts) {
  assertUuid(userId, "user id");
  const reason = requireReason(rawReason);
  return db(o).withSystem(
    "admin.user.revoke_sessions",
    async (tx) => {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!u) throw new AdminError(404, "User not found");
      const gone = await tx
        .delete(sessions)
        .where(eq(sessions.userId, userId))
        .returning({ id: sessions.id });
      await writeAudit(tx, {
        actor: admin.id,
        action: "admin.user.revoke_sessions",
        target: userId,
        reason,
        meta: { targetUserId: userId, sessionsRevoked: gone.length },
      });
      return { sessionsRevoked: gone.length };
    },
    { actor: admin.id },
  );
}

// ---- credits --------------------------------------------------------------------------------------------------------

/** Manual grant (influencers, beta users, goodwill) as a top-up-style lot. `requestId` makes a double submit a no-op. */
export async function grantCredits(
  admin: Actor,
  userId: string,
  credits: unknown,
  rawReason: unknown,
  requestId: unknown,
  o?: Opts,
) {
  assertUuid(userId, "user id");
  const reason = requireReason(rawReason);
  if (typeof credits !== "number" || !Number.isInteger(credits) || credits <= 0 || credits > MAX_ADMIN_GRANT)
    throw new AdminError(400, `Credits must be a whole number from 1 to ${MAX_ADMIN_GRANT}`);
  const key =
    typeof requestId === "string" && requestId.length >= 8 && requestId.length <= 80
      ? requestId
      : randomUUID();
  return db(o).withSystem(
    "admin.credits.grant",
    async (tx) => {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!u) throw new AdminError(404, "User not found");
      const g = await adminGrant(userId, credits, admin.id, key, {}, { tx });
      if (!g.duplicate)
        await writeAudit(tx, {
          actor: admin.id,
          action: "admin.credits.grant",
          target: userId,
          reason,
          meta: { targetUserId: userId, credits, lotId: g.lotId },
        });
      return g;
    },
    { actor: admin.id },
  );
}

/** Full refund of one investigation's charge (once per investigation: the ledger refuses a second). */
export async function refundInvestigation(
  admin: Actor,
  investigationId: string,
  rawReason: unknown,
  o?: Opts & { expectUserId?: string },
) {
  assertUuid(investigationId, "investigation id");
  const reason = requireReason(rawReason);
  return db(o).withSystem(
    "admin.credits.refund",
    async (tx) => {
      const [inv] = await tx
        .select({ id: investigations.id, userId: investigations.userId })
        .from(investigations)
        .where(eq(investigations.id, investigationId));
      // the user page passes its user id: an investigation that belongs to someone else is "not found" there
      if (!inv || (o?.expectUserId && inv.userId !== o.expectUserId))
        throw new AdminError(404, "Investigation not found");
      const r = await refund(inv.userId, inv.id, {}, { tx });
      await writeAudit(tx, {
        actor: admin.id,
        action: "admin.credits.refund",
        target: inv.userId,
        reason,
        meta: {
          targetUserId: inv.userId,
          investigationId: inv.id,
          refunded: r.refunded,
          charged: r.charged,
          alreadyRefunded: r.alreadyRefunded,
        },
      });
      return r;
    },
    { actor: admin.id },
  );
}

// ---- abuse queue ----------------------------------------------------------------------------------------------------

export type ReviewItem =
  | { kind: "flag"; id: string } // an existing abuse_flags row
  | { kind: "run"; id: string } // a blocked_query run (no flag row yet)
  | { kind: "user"; id: string }; // a user with repeated blocked queries
export type ReviewStatus = "reviewed" | "dismissed" | "actioned";

/** Mark a queue item reviewed. Run and user items get an abuse_flags row recording the review, which also removes them from the queue. */
export async function markAbuseReviewed(
  admin: Actor,
  item: ReviewItem,
  status: ReviewStatus,
  rawReason: unknown,
  o?: Opts,
) {
  assertUuid(item.id, "item id");
  if (!["reviewed", "dismissed", "actioned"].includes(status)) throw new AdminError(400, "Unknown status");
  const reason = requireReason(rawReason);
  return db(o).withSystem(
    "admin.abuse.review",
    async (tx) => {
      const now = new Date();
      const review = { status, reviewedAt: now, reviewedBy: admin.id } as const;
      let targetUserId: string | null = null;
      let flagId: string;
      if (item.kind === "flag") {
        const rows = await tx
          .update(abuseFlags)
          .set(review)
          .where(eq(abuseFlags.id, item.id))
          .returning({ id: abuseFlags.id, userId: abuseFlags.userId });
        if (rows.length === 0) throw new AdminError(404, "Flag not found");
        flagId = rows[0]!.id;
        targetUserId = rows[0]!.userId;
      } else if (item.kind === "run") {
        const [inv] = await tx
          .select({ id: investigations.id, userId: investigations.userId })
          .from(investigations)
          .where(and(eq(investigations.id, item.id), eq(investigations.failureReason, "blocked_query")));
        if (!inv) throw new AdminError(404, "Blocked run not found");
        targetUserId = inv.userId;
        const [f] = await tx
          .insert(abuseFlags)
          .values({ userId: inv.userId, investigationId: inv.id, kind: "blocked_query", ...review })
          .returning({ id: abuseFlags.id });
        flagId = f!.id;
      } else {
        const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, item.id));
        if (!u) throw new AdminError(404, "User not found");
        targetUserId = u.id;
        const [f] = await tx
          .insert(abuseFlags)
          .values({ userId: u.id, kind: "repeated_blocked", ...review })
          .returning({ id: abuseFlags.id });
        flagId = f!.id;
      }
      await writeAudit(tx, {
        actor: admin.id,
        action: "admin.abuse.review",
        target: targetUserId,
        reason,
        meta: { targetUserId, item: item.kind, itemId: item.id, flagId, status },
      });
      return { flagId };
    },
    { actor: admin.id },
  );
}

// ---- abuse review: the explicit "open results" action ----------------------------------------------------------------

export interface ReviewContent {
  investigation: {
    id: string;
    userId: string;
    query: string;
    status: string;
    depth: string;
    createdAt: Date;
  };
  summaryMarkdown: string | null;
  keyFindings: string[];
  entities: Array<{ type: string; display: string; sensitive: boolean; confidence: number }>;
  sources: Array<{ name: string; url: string | null; kind: string }>;
}

/**
 * The ONLY path by which an admin sees investigation results, and it is audited with a typed reason. Entities come
 * back as their display form (masked for sensitive types): raw values and the credential vault are never read.
 */
export async function openForAbuseReview(
  admin: Actor,
  investigationId: string,
  rawReason: unknown,
  o?: Opts,
): Promise<ReviewContent> {
  assertUuid(investigationId, "investigation id");
  const reason = requireReason(rawReason);
  return db(o).withSystem(
    "admin.investigation.open_review",
    async (tx) => {
      const [inv] = await tx
        .select({
          id: investigations.id,
          userId: investigations.userId,
          query: investigations.query,
          status: investigations.status,
          depth: investigations.depth,
          createdAt: investigations.createdAt,
        })
        .from(investigations)
        .where(eq(investigations.id, investigationId));
      if (!inv) throw new AdminError(404, "Investigation not found");
      await writeAudit(tx, {
        actor: admin.id,
        action: "admin.investigation.open_review",
        target: `investigation:${inv.id}`,
        reason,
        meta: { targetUserId: inv.userId, investigationId: inv.id },
      });
      const [sum] = await tx
        .select({ markdown: invSummary.markdown, keyFindings: invSummary.keyFindings })
        .from(invSummary)
        .where(eq(invSummary.investigationId, inv.id));
      const ents = await tx
        .select({
          type: invEntities.type,
          display: invEntities.displayValue,
          sensitive: invEntities.sensitive,
          confidence: invEntities.confidence,
        })
        .from(invEntities)
        .where(eq(invEntities.investigationId, inv.id))
        .orderBy(desc(invEntities.confidence))
        .limit(200);
      const srcs = await tx
        .select({
          name: invSources.name,
          url: invSources.url,
          kind: invSources.kind,
          excerpt: invSources.excerpt,
        })
        .from(invSources)
        .where(eq(invSources.investigationId, inv.id))
        .limit(100);
      return {
        investigation: inv,
        summaryMarkdown: sum?.markdown ?? null,
        keyFindings: sum?.keyFindings ?? [],
        entities: ents,
        sources: srcs,
      };
    },
    { actor: admin.id },
  );
}

// ---- archive --------------------------------------------------------------------------------------------------------

/** Remove an archive entity, source or page via the archive package (tombstone + object deletion + its own audit row). */
export async function removeArchiveItem(
  admin: Actor,
  req: { kind: unknown; key: unknown; reason: unknown },
  objectStore: ArchiveObjectStore,
  o?: Opts,
) {
  const reason = requireReason(req.reason);
  const kind = req.kind as RemovalKind;
  if (!["entity", "source", "page"].includes(kind)) throw new AdminError(400, "Unknown kind");
  if (typeof req.key !== "string" || !req.key.trim()) throw new AdminError(400, "A key is required");
  try {
    return await removeFromArchive(
      { kind, key: req.key.trim(), reason, actor: admin.id },
      { objectStore, database: db(o) },
    );
  } catch (e) {
    // the archive package throws plain Errors for malformed keys; that is the caller's input
    throw new AdminError(400, e instanceof Error ? e.message : "Removal failed");
  }
}

// ---- blocked email domains (UI over H1's table) ---------------------------------------------------------------------

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export function normaliseDomain(raw: unknown): string {
  const d = typeof raw === "string" ? raw.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "") : "";
  if (!DOMAIN_RE.test(d)) throw new AdminError(400, "Enter a domain like example.com");
  return d;
}

export async function addBlockedDomain(admin: Actor, rawDomain: unknown, rawReason: unknown, o?: Opts) {
  const domain = normaliseDomain(rawDomain);
  const reason = requireReason(rawReason);
  return db(o).withSystem(
    "admin.blocked_domain.add",
    async (tx) => {
      const ins = await tx
        .insert(blockedEmailDomains)
        .values({ domain, reason, createdBy: admin.id })
        .onConflictDoNothing()
        .returning({ domain: blockedEmailDomains.domain });
      if (ins.length === 0) throw new AdminError(409, "That domain is already blocked");
      await writeAudit(tx, {
        actor: admin.id,
        action: "admin.blocked_domain.add",
        target: `domain:${domain}`,
        reason,
      });
      return { domain };
    },
    { actor: admin.id },
  );
}

export async function removeBlockedDomain(admin: Actor, rawDomain: unknown, rawReason: unknown, o?: Opts) {
  const domain = normaliseDomain(rawDomain);
  const reason = requireReason(rawReason);
  return db(o).withSystem(
    "admin.blocked_domain.remove",
    async (tx) => {
      const del = await tx
        .delete(blockedEmailDomains)
        .where(eq(blockedEmailDomains.domain, domain))
        .returning({ domain: blockedEmailDomains.domain });
      if (del.length === 0) throw new AdminError(404, "That domain isn't blocked");
      await writeAudit(tx, {
        actor: admin.id,
        action: "admin.blocked_domain.remove",
        target: `domain:${domain}`,
        reason,
      });
      return { domain };
    },
    { actor: admin.id },
  );
}
