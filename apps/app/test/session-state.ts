// Test double for the session contract (@/lib/auth/session): the test picks "who is signed in".
export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}
export interface TestSessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: "user" | "admin";
  plan: "free" | "pro" | "pro_plus";
  status: "active" | "suspended" | "banned";
  aupAcceptedAt: Date | null;
}
let current: TestSessionUser | null = null;
export const setSessionUser = (u: TestSessionUser | null) => {
  current = u;
};
export async function getSessionUser() {
  return current;
}
export async function requireUser() {
  if (!current) throw new AuthError(401, "Sign in required");
  if (current.status !== "active") throw new AuthError(403, "Account is not active");
  return current;
}
