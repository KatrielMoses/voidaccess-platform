# @voidaccess/archive

The shared, anonymous archive. Every finished investigation is filed into one corpus so later investigations can
say "this has been seen before, on N independent sites". The archive is a source of leads, never of facts.

## What is stored

| Table / object                                          | Holds                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archive_entities`                                      | One row per (type, canonical value). Display value, tier, feed match, first and last seen. Sensitive entities (emails, phones, credentials, wallets) hold a masked display value and a fingerprint only, never the raw value. |
| `archive_sources`                                       | One row per canonical page URL: host, kind, first fetched, last alive, last seen, content hash, snapshot path, a 500 character excerpt.                                                                                       |
| `archive_observations`                                  | (entity, source, observed at). The observation date is the source fetch time.                                                                                                                                                 |
| `archive_relationships`, `archive_relationship_sources` | Entity pairs seen together, with the independent source count, tier and the evidence pages.                                                                                                                                   |
| `pages/<sha256>.txt.gz`                                 | Sanitised page text, gzip, keyed by the hash of the text (so identical pages are stored once). Versioned bucket.                                                                                                              |
| `archive_removed_pages`                                 | Hashes of removed pages, so the same content cannot be filed again. System-only.                                                                                                                                              |
| `archive_jobs`                                          | The queue. One row per run waiting to be filed: the run id and retry bookkeeping only. Deleted on success. System-only.                                                                                                       |

## What is not stored

No user id, investigation id, run id, query text, prompt, email, IP, device or searcher, in any archive table or object.
A schema guard test fails the build if a corpus table gains such a column. The raw run bundle is never kept (it contains
the run id and the query); the archive re-derives entities from it and discards it. Only page text that already passed
the runner's sanitiser is stored, and it is scanned again at filing (credential and personal data patterns); a page that
trips the scan is dropped, not stored. DATE entities are skipped.

## Anonymity guarantees

1. Nothing in the corpus links to a user, an account or a run. The queue row is the only place a run id appears and it is
   deleted once the run is filed.
2. Reads happen on behalf of a viewer: "seen before" excludes the viewer's own sources, so a user is never told about
   their own earlier work as if it were someone else's.
3. A viewer sees public facts about the archive (counts, dates, tiers, excerpts of public pages). Never who found them.
4. Sensitive values never leave masked form.
5. An archive failure never changes the run, its credits or its results.

## Tiers

- `unconfirmed`: one source.
- `corroborated`: two or more independent sources. Independent means distinct registrable domains (an onion host counts
  as its full host). One site posting a thousand pages is still one source, which is what stops poisoning from one place.
- `feed_validated`: matched against a public feed (CISA KEV for CVEs, refreshed by `pnpm --filter @voidaccess/archive update-feeds`).

The product wording is "leads, not facts". It never says "victim of" or "attributed to".

## Canonicalisation

Refang (`hxxp`, `[.]`), lowercase hosts, strip tracking parameters and fragments, fold names (case, accents,
punctuation), strip org legal suffixes (Inc, Ltd, GmbH and so on). Group names unify through `data/aliases.json`
(each alias has a public source URL), for example ALPHV and BlackCat become one entity. Add an alias by editing that
file with a source link.

## Liveness

`last_alive` is the latest successful fetch. `last_seen` is bumped by mentions of the URL without a fetch. A source is
shown as "no longer online" when it was fetched once, has been mentioned since, and a snapshot exists. The snapshot is
what the viewer can still read.

## API

```ts
archiveRun(runId, deps: ArchiveDeps, opts?)       // idempotent, one transaction, safe to run concurrently
enqueueArchive(runId)                             // one line in lib/runs/complete.ts
processArchiveQueue({ depsFor, batch, budgetMs }) // FOR UPDATE SKIP LOCKED, exponential backoff, 8 attempts
archiveContext(probe, opts)                       // entity context for a viewer
archiveGraph(probe, { minTier, hops })            // graph neighbours (caps in GRAPH_CAPS)
removeFromArchive({ kind, key, reason, actor }, { objectStore })
```

`ArchiveDeps` is what the architect wires:

```ts
interface ArchiveDeps {
  readBundle(runId: string): Promise<unknown>; // the engine bundle for the run
  readPages(runId: string): AsyncIterable<PageRecord> | null; // pages.jsonl.gz, or null (mock engine)
  objectStore: ArchiveObjectStore; // LocalFsObjectStore (dev) or GcsObjectStore (prod)
}
```

`GcsObjectStore(bucket, token)` takes a token function (metadata server on Cloud Run). The bucket must be versioned;
`deleteAll` removes every generation.

## Removal process

For a legal request, a takedown or a poisoned source:

```
ARCHIVE_STORE_DIR=... DATABASE_URL=... pnpm --filter @voidaccess/archive remove -- \
  --kind source --key https://example.test/page --reason "takedown ticket 123" --actor ops:alice
```

`--kind` is `entity` (uuid or `TYPE:value`), `source` (uuid or URL) or `page` (sha256). Removal tombstones the rows (hidden
from every read and never revived by a later run), deletes the snapshot object and all of its versions, records the page
hash so it cannot be re-filed, recomputes the affected tiers and counts, and writes an `audit_log` row with the reason and
actor. Nothing in normal operation deletes archive data.

## Storage growth

Measured on the mock fixtures (two runs: a BlackCat Standard run and a LockBit Quick run, 364 entities, 297 sources,
205 relationships): about 200 KB of row data for both, so about 100 KB per run before indexes (indexes roughly double it).
Overlap between runs shrinks this over time because entities and sources upsert rather than append. Page snapshots are
the larger cost and depend on real fetches: estimate 60 new pages per run at about 7 KB gzipped each, so about 0.4 MB per
run, less with deduplication. At 10,000 runs that is a few GB of objects and about 1 GB of database. Measure again once
the real engine writes pages.

## Read performance

A 375-entity context lookup over an archive of about 24.6k entities and 24.9k observations: median 29 ms (max 31 ms), lite
mode 16 ms, a 2-hop graph 28 ms. `test/perf.test.ts` prints the plans. At that size the planner picks a hash join; with
hash and merge joins disabled it uses `archive_entities_type_value_uq`, which is the plan that holds at millions of rows.

## Draft wording for /trust and the privacy policy

For the site owner to review (not wired into `apps/site`).

> **The shared archive.** When an investigation finishes, VoidAccess files the public things it found (names, domains,
> onion addresses, CVE ids and the public pages they appeared on) into a shared archive. This helps later investigations
> say "this was seen before, on N independent sites".
>
> What goes in: public page text that passed our sanitiser, the entities found on those pages, and when each page was
> fetched. What never goes in: your account, your query, your run, your IP address or any email address, phone number,
> credential or wallet found on a page (those enter only as a masked display value and a one-way fingerprint).
>
> Archive entries are leads, not facts. A lead becomes "corroborated" only when two or more independent sites
> mention it, and we never say someone is a victim of, or responsible for, anything because of the archive.
>
> To have something removed from the archive, write to the contact address on this page with the page URL or the value.
> We remove it, delete the stored copy, and make sure the same content is not filed again.
