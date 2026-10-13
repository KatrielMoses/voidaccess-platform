/**
 * Every admin route. test/admin-routes.test.ts compares this registry with the files on disk, then calls each page guard
 * and API handler as an ordinary user (expects 404) and signed out (expects redirect / 401). A new admin route must be added here.
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
] as const;

export const ADMIN_API: ReadonlyArray<{ path: string; methods: readonly ("GET" | "POST" | "DELETE")[] }> = [
  { path: "/api/admin/users/[id]/status", methods: ["POST"] },
  { path: "/api/admin/users/[id]/revoke-sessions", methods: ["POST"] },
  { path: "/api/admin/users/[id]/grant", methods: ["POST"] },
  { path: "/api/admin/users/[id]/refund", methods: ["POST"] },
  { path: "/api/admin/abuse/review", methods: ["POST"] },
  { path: "/api/admin/costs/export", methods: ["GET"] },
  { path: "/api/admin/archive/remove", methods: ["POST"] },
  { path: "/api/admin/blocked-domains", methods: ["POST", "DELETE"] },
];
