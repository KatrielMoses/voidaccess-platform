import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Static pages are prerendered at build time; ISR (GitHub stars) uses the default in-memory
// incremental cache. Add an R2 cache binding later if on-demand revalidation is needed.
export default defineCloudflareConfig();
