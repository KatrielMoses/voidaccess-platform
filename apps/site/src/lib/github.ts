import { GITHUB_REPO } from "./site";

/** Live GitHub stars, cached by ISR for an hour. Returns null when unavailable (caller shows the fallback). */
export async function getStars(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "voidaccess-site" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { stargazers_count?: unknown };
    return typeof json.stargazers_count === "number" ? json.stargazers_count : null;
  } catch {
    return null;
  }
}
