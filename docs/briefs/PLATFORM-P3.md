BRIEF — Lane RESULTS, Sub-phase P3: Bundle ingest, results dashboard and identity graph, exports

First brief in the RESULTS lane. It turns a finished run's result bundle into the user's own immutable data and builds everything the user sees after a run: the summary, the interactive identity graph, searchable entity and actor tables, sources, and exports. The graph and the searchable dashboard are the product's signature, so build them with care.

You build against the three redacted fixture bundles from P0, with no dependency on sign-in or the run lifecycle. Lane APP (P2) builds those in parallel and will wire your ingest function in at merge time. Build only P3.

In parallel:
- APP (P2) in `.worktrees/p2`: auth, onboarding, run lifecycle
- ENGINE E1B (harness in the main `platform/` checkout)

Never touch `apps/site/`, `apps/app/app/(app)/investigations/page.tsx` or `investigations/[id]/page.tsx` (P2's list and progress pages), auth, billing, `runner/`, the main `platform/` checkout, or `../voidaccess`.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in `/Users/delzyn/Brand/companies/voidaccess/platform/.worktrees/p3` (git worktree, branch `p3-results`, created from `main`). Run `pnpm install` first. First push: `git push -u origin p3-results`. **Never push to `main`.**

Parallel-safe local setup: databases `voidaccess_p3_dev` and (for tests) `VA_TEST_DB=voidaccess_p3_test`; app dev server on **port 3200**. Never touch other lanes' databases.

GitHub Actions is blocked by account billing, so run the CI steps locally and report them: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @voidaccess/db db:check`.

Read first:
- `docs/LANES.md` (you are RESULTS), `docs/DATA-MODEL.md`, `docs/ARCHITECTURE.md` §4 (masking), `docs/ENGINE-CONTRACT.md` v0.3 §3–4, `docs/PRICING-v1.md` (which exports are plan-gated)
- `packages/engine-client` (`ResultBundle`, entity types, `mask.ts`, `fingerprint.ts`), `packages/engine-mock/fixtures/*.bundle.json` and `fixtures/README.md`
- `packages/db`: the `inv_*` snapshot tables, `inv_exports`, `credential_vault` and its function, `withUser`, `withSystem`
- `packages/config/src/pricing.ts`: `hasFeature`, `PLANS`, `Feature`
- `packages/ui` and `apps/app` (the P0 shell)
- the PRD section 3.4 (results), pasted at the end of this brief
- the engine UI's graph code for reference only (`../voidaccess/web/components/GraphVisualization.tsx`, `EntityMiniGraph.tsx`); don't copy it wholesale, because the cloud UI is rebuilt on the shared UI kit

Versions: Next.js 16.4, Tailwind 4.3, sigma 3.x and graphology (use the current stable releases and read their docs).

── THE P2 ↔ P3 CONTRACT (fixed; both briefs say the same) ──────────────────────
You export one function from a new package `packages/ingest`:

```ts
export interface IngestDeps {
  /** Returns the parsed bundle JSON for a run, or throws if it's missing. */
  readBundle(runId: string): Promise<unknown>;
  /** Returns an export artifact's bytes (stix, misp, sigma, yara, snort, suricata), or null. */
  readExport(runId: string, format: string): Promise<Uint8Array | null>;
}
export async function ingestBundle(runId: string, deps: IngestDeps): Promise<void>;
```

- It runs under `withSystem("ingest.bundle")`, looks the investigation up by `runId`, derives `user_id` from that row (never from input), validates the bundle with the `ResultBundle` schema, applies masking, writes all snapshot rows in **one transaction**, and is **idempotent**: a second call for the same run changes nothing.
- It does not change the investigation's status. P2's callback code calls it, then marks the run `completed` or `failed` (an ingest error means a full refund). Throw a typed `IngestError` with a `reason` when validation fails.
- For testing, build your own `IngestDeps` that reads the fixtures. P2 supplies the real `readBundle` and `readExport` (a local artifact store in development, Cloud Storage later).
- Seeding for development: a script `pnpm --filter @voidaccess/ingest seed:fixture <fixture-name>` that creates a user, an investigation row in `completed`-pending state and ingests a fixture, so you can open `/investigations/<id>/results` on port 3200 without sign-in. For the dev server, add a dev-only session shim (`DEV_AS_USER=<uuid>`), active only when `NODE_ENV=development`, living in a file clearly named `apps/app/lib/dev-session.ts`. P2 owns real auth. You request in your handoff that the shim be swapped for the real session helper at merge.

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **Isolation.** Every results page and API goes through `withUser` and looks up by investigation id under RLS, so another user's id returns 404. A test proves user B can't read A's results, entity detail, graph data, export downloads or search results. No route accepts a `user_id` from the client.
2. **Masking happens at ingest, not at display.** Entities with `sensitive: true` are stored as a masked display value plus the HMAC fingerprint. The raw value is never written to `inv_entities` or any API response. If a bundle unexpectedly carries a raw secret, ingest routes it through the vault function (encrypted, audited) and still stores only the masked form in `inv_entities`. A test fails if any `inv_*` column contains a fixture's raw sensitive value.
3. **Text only.** No image, media or HTML from dark-web sources is ever fetched or rendered. Source excerpts render as plain escaped text; nothing uses `dangerouslySetInnerHTML`. Source URLs (including onion addresses) are shown as text with a copy button, never as a clickable link and never fetched.
4. **Snapshots are immutable and complete.** After ingest, no code path updates `inv_*` rows. If the ingest transaction fails, nothing partial remains.
5. **Plan gating comes from config.** Exports beyond CSV and JSON require `hasFeature(plan, "export_all")`. The UI shows locked exports with an upgrade prompt, and the API enforces the gate on the server.
6. **Honest presentation.** Relationship edges are shown as "co-occurrence" or "typed (lead)" with an info tooltip saying edges are leads, not facts. The UI must not use words like "victim of" or "attributed to".

── DELIVERABLES ────────────────────────────────────────────────────────────────
**R1. `packages/ingest`**
- `ingestBundle` per the contract: validate, mask, normalise, write `inv_summary`, `inv_entities`, `inv_relationships`, `inv_actors`, `inv_sources`, and store the runner's export artifacts into `inv_exports` (object path or bytes, following P0's table design; read the table before choosing).
- Cross-run entity identity is **not** your job. Within one run, dedupe by `(type, value)` or fingerprint.
- Pre-compute and store what the UI needs so pages are fast: per-type entity counts, the graph's node and edge lists with community ids (from the bundle), and degree counts.
- Tests: schema failures, idempotency, atomic rollback, the masking guarantee (no raw sensitive value in any column), and a bundle with 5,000 entities (generate it) ingesting in a few seconds.

**R2. Results page** `/investigations/[id]/results` (a tab layout; each tab is its own route segment, so the graph code loads only when opened)
- **Summary tab:** the AI summary rendered from markdown with a safe renderer (no raw HTML), key findings, risk notes, confidence and source count, a stats strip (entities by type, actors, sources, duration), and a plain notice if the summary is a fallback (`summary_kind`) or empty.
- **Graph tab:** see R3.
- **Entities tab:** see R4.
- **Actors tab:** actor cards (handle, aliases, first and last seen, linked entities count, summary) with a detail drawer listing linked entities and sources.
- **Sources tab:** a list grouped by kind with name, timestamp, a text excerpt (escaped), and the URL as copy-only text (guarantee 3). Filter by kind; search within excerpts.
- **Exports tab:** a button per format (CSV, JSON, Markdown, IOC package; STIX, MISP, Sigma, YARA, Snort, Suricata where the artifact exists). Locked formats show the upgrade prompt (guarantee 5).
- A header showing the query, refined queries, depth, credits used and date, with Rename and Delete shortcuts that call P2's functions through a small interface you define (`ResultsActions`) and stub for now.

**R3. Identity graph** (the signature feature; sigma.js on WebGL with graphology)
- Layout: ForceAtlas2 in a web worker, seeded for stable results, with the layout cached per investigation so reopening is instant.
- Nodes are coloured by entity type using the existing entity colour tokens, and sized by degree. Edges are styled by type: co-occurrence is thin and muted, typed edges are brighter and labelled on hover.
- Interaction: zoom and pan, hover highlight of a node's neighbourhood, click for a **node detail panel** (value or masked value, type, confidence, first seen, tags, sources, connected nodes grouped by type, with a link to that entity in the Entities tab), and search-to-focus.
- Controls: filter by entity type (toggle chips with counts), filter by minimum confidence, hide co-occurrence-only edges, toggle community colouring, and "reset view".
- Scale: stay smooth at 5,000 nodes and 15,000 edges (measure it and report the numbers). Above a threshold show only the top nodes by degree with a "show all" toggle.
- **Export the current view as PNG and as SVG** (the viral asset). Add a small "Investigated with VoidAccess" footer line inside exported images.
- Accessibility: a non-visual alternative. The Entities tab is the screen-reader path, so include a visible "view as table" link on the graph. Respect `prefers-reduced-motion` (skip the animated layout, show the final positions).

**R4. Searchable entity dashboard**
- A table grouped or filterable by type, with columns: value (masked where sensitive), type, confidence, first seen, source count, tags.
- Full-text search over values and tags, multi-select type filters, a confidence range, a "sensitive only" toggle, column sorting and keyboard navigation, URL-synced filters (so a filtered view is shareable by URL within the same account), and virtualised rows for large result sets.
- Copy a value, copy a column and select rows. For sensitive values the copy button copies the masked form and is labelled as such.
- Entity detail drawer: all fields, linked sources with excerpts, relationships (grouped, each with its evidence sources), and which actors it belongs to.
- Search should be served by Postgres (trigram or full-text indexes on `inv_entities`, added in a migration of yours), under RLS. Show the query plan evidence in the handoff for the 5,000-entity case.

**R5. Exports** (generated on request, always under RLS)
- **CSV** (entities, relationships and sources, as one ZIP or three files), **JSON** (the full snapshot), **Markdown** (a readable report: summary, key findings, entities by type, actors, sources) and the **IOC package** (a ZIP: IOC lists by type as CSV and TXT, with sensitive values masked and a README that says so; `include_raw` is not offered).
- STIX, MISP, Sigma, YARA, Snort and Suricata are served from the artifacts stored at ingest. If an artifact is absent, hide the button and say why in the tooltip.
- Cell values that begin with `=`, `+`, `-` or `@` are prefixed in CSV to prevent spreadsheet formula injection. Test it.
- Every export is built in streaming form where practical and carries the investigation id and a generated-at timestamp.

**R6. Tests**
- Ingest tests per R1.
- Isolation tests per guarantee 1, with two users, using the fixtures.
- Component tests for the graph filters and the entity table (Vitest and Testing Library).
- One Playwright test on the seeded fixture: open results, switch tabs, filter the graph by type, click a node and see its panel, search an entity, export CSV and PNG, and confirm a locked export prompts an upgrade on a free-plan user.
- A performance check: results for the 375-entity fixture render the graph in under 2 s, and the generated 5,000-entity bundle stays interactive (report the frame rate you measured).

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- The local CI steps pass and the Playwright test passes.
- No raw sensitive fixture value appears in any `inv_*` column, API response, export or rendered page (an automated scan proves it).
- Another user's investigation id returns 404 on every results route and export.
- The graph is smooth at 5,000 nodes (numbers reported) and exports a PNG and an SVG.
- Screenshots of every tab for the largest fixture, at 375 px and 1440 px, are in `apps/app/docs/screenshots/results/`.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- Justify every dependency in the handoff (expect sigma, graphology, a virtual-list library, a markdown renderer with HTML disabled, and a ZIP library). Keep them few.
- Don't edit architect-owned paths (`packages/config`, `tokens.css`, root workspace files except adding devDependencies, `docs/`), P2's pages or files, or P0's schema except by adding new migrations. Request changes in the handoff.
- Never print secrets. No real user data; the fixtures are already redacted.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- Push `p3-results` only. **Don't merge.** The architect reviews and merges.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- the archive: cross-run entity resolution, "From the VoidAccess archive" enrichment and graph expansion (P4)
- share links and report PDFs, the actor library across investigations, notes (P8)
- unmasking for verified domain owners (P8)
- the real artifact store and runner (R0 and P2)

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the `ingestBundle` contract as implemented, and what `IngestDeps` P2 must provide
- the masking evidence and the automated scan
- the route map
- graph performance numbers (nodes, edges, frame rate, time to first render) and the layout approach
- the search query plan for 5,000 entities, and the migration you added
- what each export contains, and the CSV injection test
- every dependency with its reason
- the dev-session shim and what to swap at merge
- the local CI output and the Playwright result
- screenshots
- requests for architect-owned files
- deviations with reasons

── APPENDIX: PRD section 3.4 ───────────────────────────────────────────────────
Katriel will paste PRD section 3.4 (Investigation results) below this line when sending the brief.
