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
pnpm deploy                   # minimal site by default; SITE_MODE=full pnpm deploy for the marketing site. Reads secrets
                              # from GCP Secret Manager; deploys nothing if any is missing
```

## Minimal mode (`SITE_MODE=minimal`)

Launch state of voidaccess.pro: only the auth pages (`/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`,
`/check-email`, `/verified`), `/acceptable-use`, `/privacy`, `/terms`, a placeholder home and `robots.txt`. Everything
else (marketing pages, waitlist, `/api/*`, `/llms*.txt`, `/og`, `/sitemap.xml`, `/pl/*`) answers 404 and the waitlist
database code never runs, so no `DATABASE_URL`, `RESEND_API_KEY` or `IP_HASH_SALT` is needed.

- Build-time flag, inlined by `next.config.ts` (`NEXT_PUBLIC_SITE_MODE`). One allowlist: `src/lib/site-mode.ts`.
  Enforced by `src/proxy.ts` (also 301s `www.` to the bare host) and by `minimalGuard()` in the route handlers.
- `pnpm dev:minimal` (port 3700), `pnpm build:minimal`, `pnpm cf:build:minimal`, `pnpm test:e2e:minimal` (port 3701, no DB, no app).
- Auth pages call Better Auth on the app (`NEXT_PUBLIC_APP_URL`, default `https://app.voidaccess.pro`; local
  `http://app.va.localhost:3600`) with `credentials: "include"`. The session cookie lives on the app domain; this site never
  reads it. Turnstile is verified by the app; this site only needs the public `NEXT_PUBLIC_TURNSTILE_SITE_KEY` at build time.
- `wrangler.jsonc` is the minimal production config; `wrangler.full.jsonc` is the full site (waitlist DB, rate limiter).

- Copy: `content/` (see `content/README.md`). Prices: only from `packages/config` via `src/lib/facts.ts`.
- Waitlist: `POST /api/waitlist`, `GET /api/waitlist/confirm`; table in `packages/db/src/schema/waitlist.ts`,
  migration in `drizzle/`.
- Screenshots: `node scripts/screenshots.mjs` writes `docs/screenshots/`.
