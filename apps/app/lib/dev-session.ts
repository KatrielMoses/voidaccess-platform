/**
 * Session lookup for the results routes (lane RESULTS, P3): P2's real session (Better Auth,
 * httpOnly cookie). The user must be signed in and active; anyone else gets null (404/401).
 */
import { getSessionUser } from "@/lib/auth/session";

export async function getSessionUserId(): Promise<string | null> {
  const user = await getSessionUser();
  return user && user.status === "active" ? user.id : null;
}
