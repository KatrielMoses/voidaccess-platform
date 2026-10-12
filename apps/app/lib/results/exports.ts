/**
 * Export builders. All inputs come from loadSnapshot() (RLS-scoped, already masked), so nothing here can
 * see a raw sensitive value. Zip output is streamed with fflate; every export carries the investigation
 * id and a generated-at timestamp.
 */
import { Zip, ZipDeflate, strToU8 } from "fflate";
import { entityCategory, type EntityType } from "@voidaccess/engine-client";
import { toCsv } from "./csv";
import type { SnapshotForExport } from "./types";

export * from "./formats";

const stamp = (now: Date) => now.toISOString();

function entityLookup(s: SnapshotForExport) {
  return new Map(s.entities.map((e) => [e.bundleId, e]));
}

export function entitiesCsv(s: SnapshotForExport): string {
  return toCsv(
    [
      "id",
      "type",
      "value",
      "sensitive",
      "confidence",
      "first_seen",
      "source_count",
      "tags",
      "degree",
      "community",
    ],
    s.entities.map((e) => [
      e.bundleId,
      e.type,
      e.displayValue,
      e.sensitive,
      e.confidence,
      e.firstSeen,
      e.sourceCount,
      e.tags.join("; "),
      e.degree,
      e.community,
    ]),
  );
}

export function relationshipsCsv(s: SnapshotForExport): string {
  const by = entityLookup(s);
  return toCsv(
    [
      "source_id",
      "source_type",
      "source_value",
      "target_id",
      "target_type",
      "target_value",
      "kind",
      "weight",
      "evidence_source_ids",
    ],
    s.relationships.map((r) => {
      const a = by.get(r.sourceBundleId);
      const b = by.get(r.targetBundleId);
      return [
        r.sourceBundleId,
        a?.type,
        a?.displayValue,
        r.targetBundleId,
        b?.type,
        b?.displayValue,
        r.type === "CO_APPEARED_ON" ? "co-occurrence" : `typed (lead): ${r.type}`,
        r.weight,
        r.evidenceSourceIds.join("; "),
      ];
    }),
  );
}

export function sourcesCsv(s: SnapshotForExport): string {
  return toCsv(
    ["id", "kind", "name", "url", "fetched_at", "excerpt"],
    s.sources.map((x) => [x.bundleId, x.kind, x.name, x.url, x.fetchedAt, x.excerpt]),
  );
}

function readme(s: SnapshotForExport, now: Date, what: string, extra: string[] = []): string {
  return [
    `VoidAccess export: ${what}`,
    `Investigation: ${s.investigation.id}`,
    `Query: ${s.investigation.query}`,
    `Generated at: ${stamp(now)}`,
    "",
    "Credentials and personal data (emails, phone numbers, names) are masked. Raw values are never included.",
    "Relationship edges are leads extracted from co-mentions, not verified facts.",
    "Source URLs, including .onion addresses, are plain text. Do not open them unless you know what you are doing.",
    ...extra,
    "",
  ].join("\n");
}

/** Streams a ZIP built from in-memory text files (they are small relative to the snapshot). */
export function zipStream(files: { name: string; data: string }[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) return controller.error(err);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      for (const f of files) {
        const entry = new ZipDeflate(f.name, { level: 6 });
        zip.add(entry);
        entry.push(strToU8(f.data), true);
      }
      zip.end();
    },
  });
}

export function buildCsvZip(s: SnapshotForExport, now = new Date()) {
  return zipStream([
    { name: "entities.csv", data: entitiesCsv(s) },
    { name: "relationships.csv", data: relationshipsCsv(s) },
    { name: "sources.csv", data: sourcesCsv(s) },
    { name: "README.txt", data: readme(s, now, "CSV (entities, relationships, sources)") },
  ]);
}

export function buildJson(s: SnapshotForExport, now = new Date()): string {
  const { investigation: inv } = s;
  return JSON.stringify(
    {
      investigation_id: inv.id,
      generated_at: stamp(now),
      note: "Sensitive values are masked; raw values are never exported. Edges are leads, not facts.",
      query: inv.query,
      refined_queries: inv.refinedQueries,
      depth: inv.depth,
      credits_charged: inv.creditsCharged,
      completed_at: inv.completedAt,
      summary: inv.summary,
      entities: s.entities.map((e) => ({
        id: e.bundleId,
        type: e.type,
        value: e.sensitive ? null : e.value,
        display_value: e.displayValue,
        sensitive: e.sensitive,
        confidence: e.confidence,
        first_seen: e.firstSeen,
        source_count: e.sourceCount,
        tags: e.tags,
        degree: e.degree,
        community: e.community,
      })),
      relationships: s.relationships.map((r) => ({
        source: r.sourceBundleId,
        target: r.targetBundleId,
        kind: r.type === "CO_APPEARED_ON" ? "co-occurrence" : "typed",
        type: r.type,
        weight: r.weight,
        evidence_source_ids: r.evidenceSourceIds,
      })),
      actors: s.actors.map((a) => ({
        id: a.bundleId,
        handle: a.handle,
        aliases: a.aliases,
        first_seen: a.firstSeen,
        last_seen: a.lastSeen,
        summary: a.summary,
        entity_ids: a.entities.map((e) => e.bundleId),
      })),
      sources: s.sources.map((x) => ({
        id: x.bundleId,
        kind: x.kind,
        name: x.name,
        url: x.url,
        fetched_at: x.fetchedAt,
        excerpt: x.excerpt,
      })),
    },
    null,
    2,
  );
}

/** Markdown links become `text (url)` with the URL in code: an export should never contain a one-click onion link. */
export function defang(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, t: string, u: string) => `${t} (\`${u}\`)`);
}

const mdEscape = (s: string) => s.replace(/[|\\`*_{}[\]<>#]/g, (c) => `\\${c}`);

export function buildMarkdown(s: SnapshotForExport, now = new Date()): string {
  const { investigation: inv } = s;
  const lines: string[] = [
    `# VoidAccess investigation report`,
    "",
    `- Investigation: \`${inv.id}\``,
    `- Query: ${mdEscape(inv.query)}`,
    `- Depth: ${inv.depth}`,
    `- Generated at: ${stamp(now)}`,
    `- Confidence: ${inv.summary.confidence} (${inv.summary.sourceCount} sources)`,
    "",
    "> Sensitive values are masked. Relationship edges are leads extracted from co-mentions, not verified facts.",
    "",
    "## Summary",
    "",
    defang(inv.summary.markdown).trim(),
    "",
  ];
  if (inv.summary.keyFindings.length)
    lines.push("## Key findings", "", ...inv.summary.keyFindings.map((f) => `- ${mdEscape(f)}`), "");
  if (inv.summary.riskNotes.length)
    lines.push("## Risk notes", "", ...inv.summary.riskNotes.map((f) => `- ${mdEscape(f)}`), "");
  lines.push("## Entities by type", "");
  const byType = new Map<string, typeof s.entities>();
  for (const e of s.entities) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  for (const [type, list] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`### ${type} (${list.length})`, "");
    for (const e of list.slice(0, 200))
      lines.push(
        `- \`${e.displayValue.replaceAll("`", "'")}\`${e.sensitive ? " (masked)" : ""}, confidence ${e.confidence.toFixed(2)}`,
      );
    if (list.length > 200) lines.push(`- … and ${list.length - 200} more (see the CSV export)`);
    lines.push("");
  }
  if (s.actors.length) {
    lines.push("## Actors", "");
    for (const a of s.actors) {
      lines.push(`### ${mdEscape(a.handle)}`, "");
      if (a.aliases.length) lines.push(`- Aliases: ${a.aliases.map(mdEscape).join(", ")}`);
      lines.push(
        `- First seen: ${a.firstSeen ?? "unknown"}; last seen: ${a.lastSeen ?? "unknown"}`,
        `- Linked entities: ${a.entityCount}`,
      );
      if (a.summary) lines.push("", mdEscape(a.summary));
      lines.push("");
    }
  }
  lines.push("## Sources", "");
  for (const x of s.sources.slice(0, 300)) {
    lines.push(`- **${mdEscape(x.name)}** (${x.kind}, ${x.fetchedAt})${x.url ? `: \`${x.url}\`` : ""}`);
    if (x.excerpt) lines.push(`  > ${mdEscape(x.excerpt).replace(/\s+/g, " ")}`);
  }
  if (s.sources.length > 300) lines.push(`- … and ${s.sources.length - 300} more (see the CSV export)`);
  lines.push("", "---", "Investigated with VoidAccess", "");
  return lines.join("\n");
}

const IOC_CATEGORIES = new Set([
  "network",
  "crypto",
  "malware",
  "vulnerability",
  "messaging",
  "identity",
  "credential",
]);

/** Indicator-like entities only (no organisations, dates or locations). */
export function iocGroups(s: SnapshotForExport): Map<string, SnapshotForExport["entities"]> {
  const out = new Map<string, SnapshotForExport["entities"]>();
  for (const e of s.entities) {
    if (!IOC_CATEGORIES.has(entityCategory(e.type as EntityType))) continue;
    out.set(e.type, [...(out.get(e.type) ?? []), e]);
  }
  return out;
}

export function buildIocZip(s: SnapshotForExport, now = new Date()) {
  const groups = iocGroups(s);
  const files: { name: string; data: string }[] = [];
  const all: unknown[][] = [];
  for (const [type, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const slug = type.toLowerCase();
    files.push({
      name: `iocs/${slug}.csv`,
      data: toCsv(
        ["type", "value", "masked", "confidence", "first_seen"],
        list.map((e) => [type, e.displayValue, e.sensitive, e.confidence, e.firstSeen]),
      ),
    });
    files.push({ name: `iocs/${slug}.txt`, data: list.map((e) => e.displayValue).join("\n") + "\n" });
    for (const e of list) all.push([type, e.displayValue, e.sensitive, e.confidence, e.firstSeen]);
  }
  files.push({
    name: "iocs/all.csv",
    data: toCsv(["type", "value", "masked", "confidence", "first_seen"], all),
  });
  files.push({
    name: "README.txt",
    data: readme(s, now, "IOC package", [
      "",
      `Contents: ${groups.size} indicator types, ${all.length} indicators. One CSV and one TXT per type, plus all.csv.`,
      "Masked values (credentials, emails, phone numbers, names) are not usable as detection indicators on their own; raw values are not offered.",
    ]),
  });
  return zipStream(files);
}
