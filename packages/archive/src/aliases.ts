import aliasData from "../data/aliases.json" with { type: "json" };

export interface AliasGroup {
  name: string;
  type: string;
  aliases: string[];
  source: string;
}

export interface AliasHit {
  canonical: string;
  display: string;
  type: string;
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/[^\w]/g, "");

export const ALIAS_GROUPS: AliasGroup[] = aliasData.groups as AliasGroup[];

const byFolded = new Map<string, AliasHit>();
for (const g of ALIAS_GROUPS) {
  const hit: AliasHit = { canonical: fold(g.name), display: g.name, type: g.type };
  byFolded.set(fold(g.name), hit);
  for (const a of g.aliases) byFolded.set(fold(a), hit);
}

/** The group an already-folded name belongs to, if the reviewed seed knows it. */
export function aliasFor(folded: string): AliasHit | undefined {
  return byFolded.get(folded);
}

/** Every alias (display forms) of the group a canonical key belongs to; for "also known as". */
export function aliasesOf(canonical: string): string[] {
  const g = ALIAS_GROUPS.find((x) => fold(x.name) === canonical);
  return g ? g.aliases : [];
}

export { fold as foldAlias };
