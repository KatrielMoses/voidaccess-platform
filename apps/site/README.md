# apps/site

Marketing site and waitlist for voidaccess.pro. Owned by lane SITE (P1); see `docs/LANES.md`.
Next.js 16 App Router + Tailwind 4 (tokens from `@voidaccess/ui`), deployed to Cloudflare Workers with OpenNext.

```bash
pnpm install
createdb voidaccess_site_dev && createdb voidaccess_site_test
cp .env.example .env.local
DATABASE_URL=postgres://localhost:5432/voidaccess_site_dev pnpm db:migrate     # same for _test
pnpm dev                      # http://localhost:3100
pnpm test                     # vitest (price guard, llms/JSON-LD, waitlist, DB)
pnpm test:e2e                 # Playwright smoke: builds, starts on :3101, uses Turnstile test keys + log mail
pnpm build && pnpm start      # then: pnpm lighthouse   (LH_PROFILE=slow4g for Lighthouse's stricter default)
pnpm cf:preview               # OpenNext build + wrangler dev on :8788 (needs .dev.vars)
pnpm deploy                   # reads secrets from GCP Secret Manager; deploys nothing if any is missing
```

- Copy: `content/` (see `content/README.md`). Prices: only from `packages/config` via `src/lib/facts.ts`.
- Waitlist: `POST /api/waitlist`, `GET /api/waitlist/confirm`; table in `packages/db/src/schema/waitlist.ts`,
  migration in `drizzle/`.
- Screenshots: `node scripts/screenshots.mjs` writes `docs/screenshots/`.
