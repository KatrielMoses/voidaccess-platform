// Web Crypto only, so it runs identically on Node and on Workers.
const enc = new TextEncoder();

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}

export function randomToken(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...arr)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
