export type TurnstileVerifier = (token: string | undefined, ip: string | null) => Promise<boolean>;

/** Server-side Turnstile check. Fails closed when the secret is missing. */
export const verifyTurnstile: TurnstileVerifier = async (token, ip) => {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
};
