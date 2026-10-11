# Lanes and path ownership

Each chat works in its own git worktree under `platform/.worktrees/<lane>`, on its own branch, and edits only the paths its lane owns. The architect merges into `main`. If you need to change a path you don't own, say so in your handoff; don't edit it.

| Path | Owner | Notes |
|---|---|---|
| root workspace files (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`) | architect | lanes may add root devDependencies only by listing them in the handoff; the architect merges lockfiles |
| `packages/config/` | architect | `pricing.ts` mirrors `docs/PRICING-v1.md`; lanes read it and never edit it |
| `packages/ui/src/tokens.css` | architect | brand tokens; shared components go in `packages/ui/src/components/` (CORE owns them; SITE may add site-only components inside `apps/site`) |
| `packages/db/` | CORE (P0) | except `src/schema/waitlist.ts` + its export line, which SITE (P1) owns |
| `packages/engine-client/`, `packages/engine-mock/`, `packages/emails/` | CORE (P0) | |
| `apps/app/` | CORE (P0), later APP lanes | |
| `apps/site/` | SITE (P1) | |
| `infra/` | CORE (P0) | `infra/bootstrap/` is the architect's |
| `runner/` | RUNNER lanes (E0/E1B/R0) | |
| `docs/` | architect | lanes write only the docs their brief names |
