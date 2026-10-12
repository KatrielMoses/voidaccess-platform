BRIEF — Lane ARCHIVE, Sub-phase P4: The VoidAccess archive (permanent, dated, anonymous findings) and archive-enriched results

First brief in the ARCHIVE lane. Every completed investigation contributes its findings to a shared archive. The archive is permanent, dated and has **no link to who searched or what they typed**. Later investigations are enriched from it, so a user sees what was observed before, when, and how often, even after the dark-web source has been taken down. If someone investigates an organisation, the archive surfaces the groups and infrastructure that appeared alongside it in earlier findings, with dates and evidence.

This is the product's long-term moat. Build only P4.

In parallel: RUNNER (R0) in `.worktrees/r0` (production runner, Cloud Run launcher, cloud storage readers). Never touch `apps/app/lib/launcher/**`, `apps/app/lib/runs/spec.ts`, `apps/app/lib/runs/ingest.ts`, `apps/app/lib/runs/callbacks.ts`, `apps/app/lib/runs/settle.ts`, `runner/`, billing code (`lib/billing/**`, `app/(app)/billing/**`, `app/(app)/usage/**`, `app/api/billing/**`, `app/api/webhooks/**`), `apps/site/`, or `../voidaccess`.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in `/Users/delzyn/Brand/companies/voidaccess/platform/.worktrees/p4` (git worktree, branch `p4-archive`, created from `main`). Run `pnpm install` first. First push: `git push -u origin p4-archive`. **Never push to `main`.**

Parallel-safe local setup: databases `voidaccess_p4_dev` and (for tests) `VA_TEST_DB=voidaccess_p4_test` (suites append `_app` etc.); app dev server on **port 3500**. Never touch other lanes' databases.

CI runs on GitHub on every push (the repository is public) and must be green. Run the steps locally too, and check exit codes. Don't pipe a gating command through `tail` or `grep` and trust the result. Run the end-to-end suites from a clean worktree: a gitignored `.env.local` hid a missing-env bug in a previous lane.

**The repository is public.** No real user data, no secrets, and **no real organisation named next to a ransomware group or attack in fixtures or tests**. Use fictional organisations (Contoso, Northwind Traders, Fabrikam) and keep any real group names to those already in the public engine fixtures.

Read first:
- `docs/ROADMAP.md` v0.3 (principles 3 and the P4 row, appended below) and `docs/ARCHITECTURE.md` §2–3
- `docs/DATA-MODEL.md` and the `archive_*` tables in `packages/db/src/schema/archive.ts` (schema only, nothing writes them yet), plus the archive guard in `packages/db/test/guards.test.ts`
- `packages/ingest` (how a bundle becomes `inv_*` rows: masking, fingerprints, dedupe) and `packages/engine-client` (`ResultBundle`, entity types, masking and fingerprint functions)
- `apps/app` results routes and components (`app/(app)/investigations/[id]/results/**`, `lib/results/**`), the graph model (sigma + graphology), `lib/runs/complete.ts` (where a successful ingest finishes)
- `docs/briefs/RUNNER-R0.md`: R0's runner uploads `pages.jsonl.gz` (one line per fetched page: url, `fetched_at`, content hash, **sanitized** text) next to the bundle. This is the archive's page-snapshot input.
- `docs/baseline/E0-REPORT.md` §5: typed relationships are unreliable (e.g. "Royal TARGETS BleepingComputer"); co-occurrence is common
- `/Users/delzyn/Brand/companies/voidaccess/docs/enrichment-partners-whoisfreaks-ipgeolocation.md` (context only; the enrichment integration is a later brief)
- the engine's identity rules for canonical values (read only): `../voidaccess/extractor/identity.py`, `extractor/gazetteer.py` and the alias handling in `fingerprint/`

GCP: bucket `gs://voidaccess-cloud-archive` (versioned, 90-day soft delete, public access blocked; permanent by design) in project `voidaccess-cloud`, always with `CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess` (va-agent). In development and tests, use a local filesystem store behind the same interface.

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **No link to who searched or what they typed.**
   - Archive tables and archive objects never contain a user id, investigation id, run id, query text, email or IP of the searcher. The existing guard test must keep passing; extend it to every new archive table.
   - The transient work queue that feeds the archive is system-only, holds only a run id, and its rows are deleted once processed.
   - Observation dates come from the **source** (`fetched_at`, or the page's own posted date when known), not from when a user ran the search.
2. **Safe content only.**
   - Only sanitized page text from the runner is archived (credentials and personal data already redacted).
   - The archive ingest scans again (defence in depth) with the shared masking and credential patterns, and drops a page that still matches.
   - Sensitive entities enter the archive as masked display value plus fingerprint only. Raw values are never archived.
   - No media, ever.
3. **Permanent and dated, with a removal path.** Nothing in normal operation deletes archive data. A documented removal process (legal request, takedown, poisoning) can tombstone an entity, a source or a page snapshot. It removes the object versions from the bucket and records an `audit_log` row. Only `withSystem` admin code can do it.
4. **Honest confidence.**
   - Every archived entity and relationship carries a tier: `unconfirmed` (one source), `corroborated` (two or more independent sources, i.e. distinct source hosts or domains), or `feed_validated` (matches a licensed public feed the engine already uses, e.g. CISA KEV for CVEs).
   - Relationships are shown as **leads** with evidence counts and dates, never as facts. The UI never says "victim of" or "attributed to".
   - A single source can't raise anything above `unconfirmed`, and a flood of observations from one host counts as one source (poisoning guard).
5. **The user's run is never at risk.** Archiving happens after the investigation is completed and charged. An archive failure doesn't change the investigation's status, credits or results. It retries from the queue and is visible in logs.
6. **Isolation still holds.** Archive enrichment on a results page reads only archive tables, plus the viewer's own investigation through `withUser`. A test proves that user B's private investigation rows never appear in user A's archive panel. Only the anonymous archive facts derived from B's run may appear, which is the disclosed design.

── DELIVERABLES ────────────────────────────────────────────────────────────────
**A1. `packages/archive`** (new package)
- **Interface:** `archiveRun(runId, deps: ArchiveDeps)`, where:

  ```ts
  ArchiveDeps {
    readBundle(runId): Promise<unknown>;
    readPages(runId): AsyncIterable<PageRecord> | null; // null when the runner wrote no pages.jsonl.gz (the mock engine doesn't)
    objectStore: ArchiveObjectStore;                     // put/get/delete by content hash; GCS in production, local filesystem in dev/test
  }
  ```

  It must work from the bundle alone when pages are absent. In that case it archives entities, relationships and source excerpts, with no full-page snapshots.
- **Canonicalisation** (deterministic, per entity type), ported from the engine's identity rules:
  - lower-case domains; strip `www.`; refang `hxxp` and `[.]`
  - normalise onion addresses (v3, lower case)
  - normalise wallet formats by chain
  - lower-case handles without leading `@`
  - normalise CVE and ATT&CK IDs
  - organisations and groups: case- and punctuation-folded, plus an **alias table** (`archive_aliases`) seeded from a reviewed file in `packages/archive/data/aliases.json`. Start with well-known public aliases of ransomware and APT groups (e.g. ALPHV ↔ BlackCat), each with a public-source note.
  - Sensitive types use the fingerprint as their identity.
- **Write path** (one `withSystem("archive.ingest")` transaction per run; idempotent per run via the queue row):
  - upsert `archive_entities` (first_seen = min, last_seen = max, observation_count, independent_source_count, tier)
  - upsert `archive_sources` (url or onion, first_seen, last_seen, last_alive, content_hash, snapshot object key)
  - insert `archive_observations` (entity × source × observed_at, deduped on that triple)
  - upsert `archive_relationships` (a, b, type, first_seen, last_seen, evidence_count, independent_source_count, tier)
  - keep co-occurrence and typed relationships as distinct types
- **Page snapshots:** each sanitized page text is stored once, gzip-compressed, in the object store under `pages/<sha256>.txt.gz` (content-addressed, so it's deduplicated across runs). The source row records the key. Re-scan before storing (guarantee 2).
- **Liveness:** a source's `last_alive` is the latest `fetched_at` at which it returned content. A source that later fails or disappears keeps its snapshot. The UI calls it "no longer online; archived snapshot from <date>".
- **Tiers:** recompute the tier from independent source counts on every write. A source host or domain counts once per entity or relationship, however many pages it contributes.
- **Removal:** `removeFromArchive({ kind: "entity" | "source" | "page", key, reason, actor })` tombstones the rows (hidden from all reads), deletes the snapshot object and all its versions, and writes an `audit_log` row. Provide a CLI script, `pnpm --filter @voidaccess/archive remove …`. Admin UI comes later.

**A2. Queue and worker**
- A system-only table, `archive_jobs` (run id, enqueued_at, attempts, last_error), in a new migration with row-level security and system-only grants, plus its entry in the isolation test's system-only list.
- **Enqueue:** a single call added in `apps/app/lib/runs/complete.ts`, after a successful ingest (`enqueueArchive(runId)`). That is the only line you add to `lib/runs/`.
- **Processing:** `POST /api/cron/archive` (authenticated exactly like the other cron routes) processes the queue with bounded batch size and time, retries with backoff, and deletes the job row on success (guarantee 1).
- **Dev and test deps:** fixture-based, plus the mock artifact store's bundle reader exposed through a small adapter in `packages/archive` that reads `MOCK_ARTIFACT_DIR` directly. Don't edit `lib/launcher/artifacts.ts`; the architect wires the GCS readers (bundle and `pages.jsonl.gz`) from R0 at merge.

**A3. Archive-enriched results** (in the results area; reuse P3's components and styles)
- **"From the VoidAccess archive" panel** on the Summary tab and on the entity detail drawer. For the investigation's entities (batched lookups by canonical value or fingerprint), show:
  - first seen, last seen, how many independent sources, tier
  - other entities often observed with it (top N by evidence)
  - sources that are no longer online, with their archived excerpt and date (text only, escaped, copy-only URLs as in P3)
- **Graph: "Show archive context"** (off by default). It adds archive neighbours one hop from the investigation's entities (optionally two hops, capped):
  - archive nodes and edges use a distinct style and legend
  - each edge's tooltip shows type, evidence count, first and last seen, and tier
  - a minimum-tier filter
  - this is how a search for an organisation surfaces the groups and infrastructure seen alongside it before
- **Entities tab:** a "Seen before" column (first seen date and tier) and a filter for "only new to the archive".
- **API:** `GET /api/investigations/[id]/archive` and `/archive/graph`. Look up the investigation under `withUser` (404 for other users), then read archive tables via a narrow, read-only system function.
- **Performance:** archive context for a 375-entity investigation in under 300 ms with a warm DB, using indexes added in your migration (canonical value or fingerprint, and the relationship endpoints). Report query plans.

**A4. Docs**
- `docs/ARCHIVE.md` in `packages/archive/README.md` form: what is stored, what isn't, the anonymity guarantees, tiers, the removal process, and storage growth estimates (bytes per run from the fixtures).
- Draft wording for the `/trust` page and the privacy policy describing the archive, as a content snippet the growth architect will edit. Don't edit `apps/site`.

**A5. Tests**
- **Anonymity:**
  - an extended guard over every archive table and object metadata
  - after archiving runs from two users, no archive row or object contains either user id, investigation id, run id or query text (scan everything)
- **Canonicalisation:** a table-driven test per type, plus alias merges (ALPHV and BlackCat become one entity).
- **Tiers and poisoning:**
  - 20 pages from one host give `unconfirmed`
  - 2 hosts give `corroborated`
  - a CVE in CISA KEV gives `feed_validated`
- **Idempotency:** archiving the same run twice changes nothing; concurrent cron workers don't double-process.
- **Removal:** a tombstoned entity is hidden from all reads and its object is gone.
- **Liveness:** a source seen alive, then missing in a later run, shows "no longer online" with its snapshot.
- **The headline flow,** with fictional names in fixtures:
  1. Run 1: a ransomware-group investigation whose leak-site source mentions "Northwind Traders".
  2. Run 2, by a different user: "Northwind Traders".
  3. Run 2's archive panel and archive graph show the group as a lead with evidence count and dates, and none of run 1's private rows.
- **Run safety:** an archive failure leaves the user's run `completed` and the ledger untouched.
- **One Playwright test:** run 1 and run 2 on the mock engine as two signed-in users (through Better Auth, like the existing suites). Open run 2's results, toggle "Show archive context", and see the archive neighbour and its tooltip.

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- CI is green on `p4-archive`, and the local steps plus the end-to-end suites (`test:e2e`, `test:e2e:results`, `test:e2e:billing` and yours) pass from a clean worktree, exit codes checked.
- The anonymity scan finds no user, investigation, run or query identifiers anywhere in the archive.
- The headline flow passes in unit and end-to-end tests.
- Archive context latency and query plans are reported.
- Screenshots of the archive panel, the archive graph toggle and the "no longer online" source at 375 px and 1440 px are in `apps/app/docs/screenshots/archive/`.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- Justify every dependency.
- Schema changes go in new migrations under `packages/db`, named clearly; the architect renumbers at merge.
- Don't edit architect-owned paths (`packages/config`, `tokens.css`, root workspace files except adding devDependencies, `docs/` except via the package README), R0's or billing's paths, or `lib/runs/` beyond the single enqueue line.
- No real organisation in fixtures paired with a group or attack. No secrets.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- Push `p4-archive` only. **Don't merge.** The architect reviews and merges.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- the relationship-precision pass that would let us label a verified group → victim claim (needs its own brief, using leak-site page structure and LLM verification)
- WhoisFreaks and ipgeolocation.io enrichment
- the archive search page (searching the archive directly without running an investigation)
- the admin UI for removals
- monitors that diff new runs against the archive (P8)
- applying migrations to Neon (deploy phase)

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the package API and the `ArchiveDeps` the architect must wire (bundle and pages readers, object store)
- the schema and migrations added
- the canonicalisation rules and the alias seed file
- tier rules and poisoning-guard evidence
- the anonymity scan evidence
- queue and cron behaviour
- the archive panel, graph toggle and APIs, with latency numbers and query plans
- storage growth per run
- the removal process
- the trust and privacy wording draft
- every dependency with its reason
- CI and local results, and the end-to-end results
- screenshots
- deviations with reasons

── APPENDIX: the archive requirement ───────────────────────────────────────────
**From ROADMAP v0.3 (2026-10-11), principle 3:** The shared corpus is ON. We keep everything we find, permanently and dated, so later searches are enriched with history even after the dark-web source has disappeared. The corpus stores findings, never who searched or what they typed.

**From ROADMAP v0.3, the P4 row:**
- Permanent, dated, anonymous findings store: GCS holds immutable dated bundles + sanitized page snapshots (retention lock, never deleted); Neon holds a compact index (canonical entities, observations with observed_at, sources with first/last seen + last alive, relationships with evidence and first/last seen).
- Ingest after every run with no user or query linkage.
- Cross-run entity resolution (canonical rules + alias table + LLM-assisted merge for orgs and groups).
- Enrich at read time: a "From the VoidAccess archive" section + 1–2 hop graph expansion (a search for an org surfaces the group that claimed it, with the dates seen).
- Confidence by independent-source count (poisoning guard). A legal removal process.

Note for this brief: the LLM-assisted merge is replaced by a reviewed alias seed file for now (deterministic and auditable). "The group that claimed it" is shown as a lead with evidence until the relationship-precision pass ships.

**Product owner's intent (2026-10-11):** "If user A searches a group and gets results, and user B searches the same group a week or a year later, the earlier output enriches B's results. Dark-web pages get taken down often, so storing the output keeps that history available, with the date it was found. If someone searches a company that a group hit, they should be linked, because the group was there."

**Product decisions:** user searches are private; findings go into a shared, anonymous, dated archive (disclosed on `/trust`). Raw credentials are never archived; only masked values and fingerprints. No media.
