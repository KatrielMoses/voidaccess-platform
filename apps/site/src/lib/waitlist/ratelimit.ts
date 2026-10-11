export interface RateLimiter {
  /** true = allowed. */
  hit(key: string, limit: number, windowSec: number): Promise<boolean>;
}

/** Per-isolate sliding window. Used locally and in tests; on Workers it is only a backstop. */
export class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}

  async hit(key: string, limit: number, windowSec: number): Promise<boolean> {
    const t = this.now();
    const cutoff = t - windowSec * 1000;
    const recent = (this.hits.get(key) ?? []).filter((x) => x > cutoff);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.hits.clear();
    return true;
  }
}

interface CfBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** Cloudflare Workers Rate Limiting binding (shared across isolates). Window/limit come from wrangler.jsonc. */
export class CloudflareRateLimiter implements RateLimiter {
  constructor(private binding: CfBinding) {}
  async hit(key: string): Promise<boolean> {
    return (await this.binding.limit({ key })).success;
  }
}

let memory: MemoryRateLimiter | undefined;

export async function getRateLimiter(): Promise<RateLimiter> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const binding = (getCloudflareContext().env as { WAITLIST_RL?: CfBinding }).WAITLIST_RL;
    if (binding) return new CloudflareRateLimiter(binding);
  } catch {
    // not running on Workers
  }
  return (memory ??= new MemoryRateLimiter());
}
