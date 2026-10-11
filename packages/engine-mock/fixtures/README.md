# Fixtures: redacted ResultBundles

Three `*.bundle.json` files (contract section 3 shape, validated against `engine-client/schemas/ResultBundle.json`) plus a tiny `*.progress.json` each (final counts used for the mock's `counts` events).

## Provenance

Built by `scripts/build-fixtures.ts` from CLI `result.json` payloads in `gs://voidaccess-cloud-runs/baseline/<run>/` (pulled with va-agent into a scratch dir; raw inputs are not committed). They are the E1B wave runs of the E0 harness (default engine config, `deepseek-chat` via OpenRouter), not the earlier E0 quick runs, because only standard/deep runs contain typed relationships (E0-REPORT section 5).

| Fixture                 | Raw run           | Query (public threat topic)       | Depth    | Entities | Relationships (typed) | Actors | Communities | Sources |
| ----------------------- | ----------------- | --------------------------------- | -------- | -------- | --------------------- | ------ | ----------- | ------- |
| lockbit-deep            | e1b1791745003-000 | LockBit ransomware leak site      | deep     | 290      | 129 (6)               | 13     | 153         | 8       |
| dprk-deep-typed         | e1b1791746263-002 | Cl0p MOVEit extortion group       | deep     | 176      | 44 (32)               | 15     | 21          | 9       |
| blackcat-standard-onion | e1b1791746263-006 | BlackCat ALPHV ransomware victims | standard | 375      | 230 (20)              | 15     | 304         | 302     |

(The name `dprk-deep-typed` is historical; the content is the Cl0p run.) Entity counts exclude engine-suppressed entities (10 / 18 / 41 dropped). Scale is real: nothing was padded or synthesized except the items listed under "Synthesized".

## Redaction rules

- Kept (public names): ransomware groups, malware families, CVE ids, MITRE ATT&CK ids, file hashes, dates, locations; MITRE/CISA/NVD and a few major security-news hosts (URL origin only, path dropped).
- Replaced with deterministic fakes (sha256-seeded, stable across runs): organisation names (all, including victims) become `<Adjective> <Noun>` fakes; actor/Telegram/Discord/other handles become `word_word NN`; emails become `name123@example.org` (display value masked `n***@example.org`); IPs move to the RFC 5737 documentation ranges; wallets become same-format random strings; onion hosts become random v3-shaped hosts with `/p/<hex>` paths; other URLs become `https://word-xxxx.example.net/<hex>`.
- Free text (summary, excerpts) is scrubbed with the same entity-to-fake table plus regexes for onions, emails, IPs, URLs, defanged domains, wallets and @handles. Excerpts are at most 200 chars and come from engine context snippets. Well-known public institutions (e.g. FBI, CrowdStrike) may remain in news-derived excerpts.
- Dropped: all page bodies, per-entity context snippets (except the single sanitized excerpt per source), raw URLs of non-allowlisted hosts, engine ids of pages.
- `run_id` is `fixture-<name>`; the mock overwrites run_id, query, depth and timestamps per run.

## Synthesized (not in the raw data)

- `sources[].name`, `kind` (mapped from the harness `source` label), `fetched_at` (spread across the run's fetch window) and `excerpt` (from the first entity snippet per URL; empty when none).
- `actors`: one per RANSOMWARE_GROUP / THREAT_ACTOR_HANDLE entity, with up to 12 related entity ids taken from relationships and a templated summary.
- `communities`: from the engine's community map; `label` is the first group/malware/handle in the community.
- `summary.key_findings` (first sentences of the model summary), `summary.risk_notes` (two templated notes), `summary.confidence` (from mean entity confidence).
- `relationships[].evidence_source_ids`: union of the two endpoint entities' source ids (the engine does not record per-edge evidence). `weight` = engine confidence.
- Metrics come from the harness `metrics` block (`stage_ms_events` for the 8 stages).

Typed edges are model-extracted co-mentions, not verified attribution (E0-REPORT section 5): do not present them as such in UI copy.
