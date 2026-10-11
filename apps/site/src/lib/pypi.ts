/** PyPI downloads last month for the engine, cached by ISR. null when unavailable (the stat is then hidden). */
export async function getPypiDownloads(): Promise<number | null> {
  try {
    const res = await fetch("https://pypistats.org/api/packages/voidaccess/recent", {
      headers: { "User-Agent": "voidaccess-site" },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { last_month?: unknown } };
    return typeof json.data?.last_month === "number" ? json.data.last_month : null;
  } catch {
    return null;
  }
}
