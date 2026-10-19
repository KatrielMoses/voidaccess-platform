/**
 * Every admin route, by its INTERNAL path (the public one is under the secret ADMIN_PATH base; see lib/admin/path.ts).
 * test/admin-routes.test.ts compares this registry with the files on disk, then calls each page guard and API handler
 * as an ordinary user, a non-owner admin and signed out (all 404), and as the owner with and without a step-up.
 * A new admin route must be added here.
 */
export const ADMIN_PAGES = [
  "/admin",
  "/admin/users",
  "/admin/users/[id]",
  "/admin/abuse",
  "/admin/costs",
  "/admin/archive",
  "/admin/founding",
  "/admin/blocked-domains",
  "/admin/review/[id]",
  "/admin/unlock",
] as const;

/** The only files allowed to call adminPage({ allowLocked: true }) / withAdminRoute(..., { allowLocked: true }). */
export const ADMIN_ALLOW_LOCKED = ["/admin/unlock", "/api/admin/mfa/verify", "/api/admin/mfa/lock"] as const;

export const ADMIN_API: ReadonlyArray<{ path: string; methods: readonly ("GET" | "POST" | "DELETE")[] }> = [
  { path: "/api/admin/users/[id]/status", methods: ["POST"] },
  { path: "/api/admin/users/[id]/revoke-sessions", methods: ["POST"] },
  { path: "/api/admin/users/[id]/grant", methods: ["POST"] },
  { path: "/api/admin/users/[id]/refund", methods: ["POST"] },
  { path: "/api/admin/abuse/review", methods: ["POST"] },
  { path: "/api/admin/costs/export", methods: ["GET"] },
  { path: "/api/admin/archive/remove", methods: ["POST"] },
  { path: "/api/admin/blocked-domains", methods: ["POST", "DELETE"] },
  { path: "/api/admin/mfa/verify", methods: ["POST"] },
  { path: "/api/admin/mfa/lock", methods: ["POST"] },
];
