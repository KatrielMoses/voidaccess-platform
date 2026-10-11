// Session contract used by every route and server component. The Better Auth wiring lives in ./auth.ts.
// Routes/pages must derive the user ONLY from here, never from client-supplied ids.
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: "user" | "admin";
  plan: "free" | "pro" | "pro_plus";
  status: "active" | "suspended" | "banned";
}

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  throw new Error("not implemented yet (wired in the auth step)");
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new AuthError(401, "Sign in required");
  if (u.status !== "active") throw new AuthError(403, "Account is not active");
  return u;
}
