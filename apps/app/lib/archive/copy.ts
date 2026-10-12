/** Wording for the archive UI in one place (the growth architect edits this file). Never "victim of" or "attributed to": edges are leads. */
export const archiveCopy = {
  title: "From the VoidAccess archive",
  intro:
    "Findings from earlier investigations are kept, anonymously and with dates, so you can see what was observed before, even after a source has gone offline. We never keep who searched or what they typed.",
  empty:
    "The archive has nothing on these entities from other sources yet. Your findings will be added, anonymously.",
  seenSummary:
    "{seen} of {total} entities were seen before in the archive from other sources. {fresh} are new to it.",
  seenHeading: "Seen before",
  neighboursHeading: "Often seen alongside",
  neighboursNote:
    "Leads, not facts: these appeared together on the same pages in earlier findings. That does not show one acted on the other.",
  offlineHeading: "No longer online",
  offlineLine: "No longer online; archived snapshot from {date}",
  lastSeenMention: "Last mentioned {date}",
  tierHelp: {
    unconfirmed: "Seen on one independent site only.",
    corroborated: "Seen on two or more independent sites.",
    feed_validated: "Matches a licensed public feed (for example CISA KEV).",
  },
  tierLabel: { unconfirmed: "unconfirmed", corroborated: "corroborated", feed_validated: "feed validated" },
  graph: {
    toggle: "Show archive context",
    hops: "Reach",
    hop1: "1 hop",
    hop2: "2 hops",
    minTier: "Minimum tier",
    legend: "Archive context (from earlier findings)",
    truncated: "Showing the strongest leads only.",
    none: "The archive has no neighbours for these entities yet.",
    nodeNote: "From the archive. Appeared alongside your entities in earlier findings.",
  },
  entities: {
    column: "Seen before",
    never: "new",
    filterLabel: "Archive",
    all: "All entities",
    onlyNew: "Only new to the archive",
    onlySeen: "Only seen before",
  },
} as const;

export const fillArchive = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
