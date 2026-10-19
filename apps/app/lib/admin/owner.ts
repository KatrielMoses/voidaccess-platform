/**
 * Who owns the admin console: an active user with role "admin" and a verified email equal (trimmed,
 * case-insensitive) to ADMIN_EMAIL (default katriel@voidaccess.pro). No next/* imports, so proxy.ts can use it.
 */
import type { SessionUser } from "@/lib/auth/session";

export type AdminUser = SessionUser & { role: "admin" };

export const DEFAULT_ADMIN_EMAIL = "katriel@voidaccess.pro";
const norm = (e: string) => e.trim().toLowerCase();
export const ownerEmail = () => norm(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL);

export const isOwner = (u: SessionUser | null | undefined): u is AdminUser =>
  !!u && u.role === "admin" && u.status === "active" && u.emailVerified && norm(u.email) === ownerEmail();
