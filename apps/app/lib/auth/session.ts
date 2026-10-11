// Session contract used by every route and server component. The Better Auth wiring lives in ./auth.ts.
// Routes/pages must derive the user ONLY from here, never from client-supplied ids.
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDatabase } from "@voidaccess/db";
import { users } from "@voidaccess/db/schema";
import { getAuth } from "./auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: "user" | "admin";
  plan: "free" | "pro" | "pro_plus";
  status: "active" | "suspended" | "banned";
  aupAcceptedAt: Date | null;
}

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

/** The signed-in user (authoritative row read under RLS as that user), or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const id = session.user.id;
  const [row] = await getDatabase().withUser(id, (tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        emailVerified: users.emailVerified,
        role: users.role,
        plan: users.plan,
        status: users.status,
        aupAcceptedAt: users.aupAcceptedAt,
      })
      .from(users)
      .where(eq(users.id, id)),
  );
  return row ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new AuthError(401, "Sign in required");
  if (u.status !== "active") throw new AuthError(403, "Account is not active");
  return u;
}
