import type { PageMeta } from "./types";

export const meta: PageMeta = {
  title: "Open source: the VoidAccess engine",
  description: "The VoidAccess engine is MIT-licensed and free to self-host forever. Star it on GitHub or sponsor the work.",
};

export const content = {
  title: "The engine is open source",
  lead: "VoidAccess started as an MIT-licensed tool you run yourself. It still is. The hosted service runs the same engine for people who'd rather not operate Tor, keys and updates.",
  points: [
    { title: "MIT licensed", body: "Read it, fork it, run it. The licence is in the repository." },
    { title: "Self-host free forever", body: "Install with pip or Docker Compose, bring your own keys, and keep your data on your machine." },
    { title: "Audited in public", body: "Release audits and the usage policy live in the repository's docs folder." },
  ],
  install: "pip install voidaccess",
  github: "View on GitHub",
  sponsors: "Sponsor on GitHub Sponsors",
  sponsorsBody: "Sponsorship funds maintenance of the open-source engine. It is separate from the hosted service.",
  starsLabel: "stars on GitHub",
};
