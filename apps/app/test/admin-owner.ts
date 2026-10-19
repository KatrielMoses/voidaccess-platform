// The console's owner in tests: an admin whose email is ADMIN_EMAIL, with a configurable request (cookies, x-va-path).
// Files that use it mock next/headers with:
//   vi.mock("next/headers", async () => (await import("./admin-owner")).nextHeadersMock);
import { signStepUp, STEP_UP_COOKIE } from "@/lib/admin/stepup";
import { makeAdmin } from "./admin-helpers";
import type { TestSessionUser } from "./session-state";

/** A test slug (not hex, not a real one): long enough for the ADMIN_PATH rule. */
export const TEST_ADMIN_PATH = "test-console-path-for-unit-tests";
export const TEST_BASE = `/${TEST_ADMIN_PATH}`;

const jar = new Map<string, string>();
const req = { path: null as string | null };

export const nextHeadersMock = {
  headers: async () => new Headers(req.path ? { "x-va-path": req.path } : {}),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
};

export const setCookie = (name: string, value: string) => void jar.set(name, value);
export const clearCookies = () => jar.clear();
export const setRequestPath = (p: string | null) => {
  req.path = p;
};

/** Turn the console on (test slug) and make a fresh admin the owner. */
export async function makeOwner(): Promise<TestSessionUser> {
  process.env.ADMIN_PATH = TEST_ADMIN_PATH;
  const a = await makeAdmin();
  process.env.ADMIN_EMAIL = `  ${a.email.toUpperCase()} `; // trimmed and case-insensitive
  return a;
}

/** A valid step-up cookie for the owner's (test) session. */
export function stepUp(owner: TestSessionUser, sessionId = `test-session-${owner.id}`, nowMs = Date.now()) {
  jar.set(STEP_UP_COOKIE, signStepUp(owner.id, sessionId, nowMs));
}
